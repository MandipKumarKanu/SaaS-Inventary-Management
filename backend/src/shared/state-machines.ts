import { AppError } from './errors.js';

/**
 * Phase 4: explicit workflow state machines (PRD §76, Rule #17).
 *
 * Transition maps are aligned with the DB CHECK constraints (migrations 004/005)
 * — no client-supplied status can skip workflow steps. See
 * phasewiseimprovementplan.md Phase 4 pre-flight decisions.
 *
 * Composite-forward edges are permitted (decision #2): a single service call
 * that moves stock (PO receive, SO fulfill, transfer ship) may advance several
 * steps along the forward path, but only forward. Pure metadata transitions
 * (approve/cancel) are single-step.
 */

export type WorkflowEntity = 'purchase_order' | 'sales_order' | 'stock_transfer' | 'customer_return' | 'inventory_count';

interface TransitionMap {
  /** Legal single-step metadata edges: from → [allowed targets] */
  transitions: Record<string, string[]>;
  /**
   * Stock-derived edges: ONLY traversable by stock-moving service methods
   * through assertStockTransition — a generic status PATCH can never fake a
   * receipt/shipment/completion without stock actually moving.
   */
  stockEdges: Record<string, string[]>;
  /**
   * Phase 7: composite-forward traversal may NOT pass through these states —
   * they are mandatory checkpoints backed by side effects (e.g. SO 'reserved'
   * holds stock; skipping it via a composite edge would oversell). Only
   * single-step edges and stock edges may touch them.
   */
  checkpointStates?: string[];
  /** Statuses from which `cancelled` may be reached (empty = not cancellable) */
  cancellableFrom: string[];
  /** Terminal statuses — no further transitions */
  terminal: string[];
  /** Per-target-status permission codes (PRD §76 action-gated transitions) */
  transitionPermissions: Record<string, string>;
}

const PURCHASE_ORDER: TransitionMap = {
  transitions: {
    draft: ['pending_approval'],
    pending_approval: ['approved'],
    approved: ['ordered'],
    ordered: ['closed'], // metadata close; receiving states come via receiveItems
    partially_received: ['closed'],
    received: ['closed'],
  },
  stockEdges: {
    ordered: ['partially_received', 'received'], // receiveItems moves stock
    partially_received: ['received'],
  },
  cancellableFrom: ['draft', 'pending_approval', 'approved'],
  terminal: ['closed', 'cancelled'],
  transitionPermissions: {
    approved: 'purchases.approve',
    ordered: 'purchases.approve',
    partially_received: 'purchases.receive',
    received: 'purchases.receive',
    closed: 'purchases.receive',
  },
};

const SALES_ORDER: TransitionMap = {
  transitions: {
    draft: ['confirmed'],
    confirmed: ['reserved'],
    reserved: ['picking'],
    picking: ['packed'],
    shipped: ['delivered'], // delivered = metadata confirmation, no stock movement
  },
  stockEdges: {
    // Phase 7: shipping CONVERTS reservations into deductions (PRD §30).
    reserved: ['shipped'],
    picking: ['shipped'],
    packed: ['shipped'],
  },
  // 'reserved' holds stock — composite traversal may never pass THROUGH it
  // (confirmed → …→ shipped without reserving would oversell).
  checkpointStates: ['reserved'],
  cancellableFrom: ['draft', 'confirmed', 'reserved', 'picking', 'packed'],
  terminal: ['delivered', 'cancelled'],
  transitionPermissions: {
    reserved: 'sales.reserve',
    shipped: 'sales.fulfill',
    delivered: 'sales.fulfill',
  },
};

const STOCK_TRANSFER: TransitionMap = {
  transitions: {
    draft: ['requested'],
    requested: ['approved'],
  },
  stockEdges: {
    // shipping deducts at source; receipt-side adds at destination
    approved: ['shipped'],
    shipped: ['in_transit', 'received', 'completed'],
    in_transit: ['received', 'completed'],
    received: ['completed'],
  },
  cancellableFrom: ['draft', 'requested', 'approved', 'shipped', 'in_transit'],
  terminal: ['completed', 'cancelled'],
  transitionPermissions: {
    approved: 'transfers.approve',
    shipped: 'transfers.ship',
    in_transit: 'transfers.ship',
    received: 'transfers.receive',
    completed: 'transfers.receive',
  },
};

const CUSTOMER_RETURN: TransitionMap = {
  transitions: {
    requested: ['approved'],
    approved: ['received'],
    received: ['inspected'],
  },
  stockEdges: {
    inspected: ['completed'], // inspectAndRestock adds stock
    approved: ['completed'], // direct restock after approval (composite)
  },
  cancellableFrom: ['requested', 'approved'],
  terminal: ['completed', 'cancelled'],
  transitionPermissions: {
    approved: 'returns.approve',
    received: 'returns.inspect',
    inspected: 'returns.restock',
    completed: 'returns.restock',
  },
};

const INVENTORY_COUNT: TransitionMap = {
  transitions: {
    draft: ['in_progress'],
    in_progress: ['review'],
  },
  stockEdges: {
    review: ['completed'], // approveCount applies variance corrections
    in_progress: ['completed'], // direct approval (composite)
  },
  cancellableFrom: ['draft', 'in_progress', 'review'],
  terminal: ['completed', 'cancelled'],
  transitionPermissions: {
    completed: 'inventory.count',
  },
};

const MACHINES: Record<WorkflowEntity, TransitionMap> = {
  purchase_order: PURCHASE_ORDER,
  sales_order: SALES_ORDER,
  stock_transfer: STOCK_TRANSFER,
  customer_return: CUSTOMER_RETURN,
  inventory_count: INVENTORY_COUNT,
};

/** Cancellation is its own transition path, not a per-target edge. */
function isCancellation(machine: TransitionMap, from: string, to: string): boolean {
  return to === 'cancelled' && machine.cancellableFrom.includes(from);
}

/** Is `to` reachable from `from` via forward steps (composite allowed)?
 *  Composite paths may never pass THROUGH a checkpoint state (Phase 7). */
function isForwardReachable(
  machine: TransitionMap,
  from: string,
  to: string,
  includeStockEdges: boolean
): boolean {
  const visited = new Set<string>([from]);
  const checkpoints = new Set(machine.checkpointStates || []);
  const edges = (m: string) =>
    checkpoints.has(m)
      ? [] // checkpoint states are exits-only: no composite path continues past them
      : [
          ...(machine.transitions[m] || []),
          ...(includeStockEdges ? machine.stockEdges[m] || [] : []),
        ];
  const queue = [...edges(from)];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (cur === to) return true;
    if (visited.has(cur)) continue;
    visited.add(cur);
    queue.push(...edges(cur));
  }
  return false;
}

export class StateMachine {
  /**
   * STRICT gate: single-step edge or cancellation only. Used by generic
   * updateStatus routes — a client can never skip workflow steps through
   * them (e.g. requested → completed without stock ever moving).
   * Throws 422 INVALID_STATUS_TRANSITION with { from, to } on violation.
   */
  static assertTransition(
    entity: WorkflowEntity,
    from: string,
    to: string
  ): void {
    if (from === to) {
      throw AppError.invalidTransition(entity, from, to, 'Status unchanged');
    }

    const machine = MACHINES[entity];
    if (!machine) {
      throw AppError.internal(`No state machine registered for entity: ${entity}`);
    }

    if (machine.terminal.includes(from)) {
      throw AppError.invalidTransition(entity, from, to, `${entity} is already ${from} (terminal)`);
    }

    const legal =
      (machine.transitions[from] || []).includes(to) ||
      isCancellation(machine, from, to);

    if (!legal) {
      throw AppError.invalidTransition(entity, from, to);
    }
  }

  /**
   * STOCK-MOVING gate: metadata edges PLUS stock-derived edges, with
   * composite-forward traversal (pre-flight decision #2). ONLY for service
   * methods that actually move stock (PO receive, SO fulfill, transfer
   * ship/receive, count approve, return restock) — a multi-step advance
   * commits the stock operations in ONE atomic batch.
   */
  static assertStockTransition(
    entity: WorkflowEntity,
    from: string,
    to: string
  ): void {
    if (from === to) {
      throw AppError.invalidTransition(entity, from, to, 'Status unchanged');
    }

    const machine = MACHINES[entity];
    if (!machine) {
      throw AppError.internal(`No state machine registered for entity: ${entity}`);
    }

    if (machine.terminal.includes(from)) {
      throw AppError.invalidTransition(entity, from, to, `${entity} is already ${from} (terminal)`);
    }

    const legal =
      (machine.transitions[from] || []).includes(to) ||
      (machine.stockEdges[from] || []).includes(to) ||
      isCancellation(machine, from, to) ||
      isForwardReachable(machine, from, to, true);

    if (!legal) {
      throw AppError.invalidTransition(entity, from, to);
    }
  }

  /**
   * Permission required to reach `to` from `from`. Returns null when the
   * transition needs no special permission beyond the route's base permission.
   * Cancellations map to their entity's cancel permission where one exists.
   */
  static requiredPermission(
    entity: WorkflowEntity,
    from: string,
    to: string
  ): string | null {
    const machine = MACHINES[entity];
    if (!machine) return null;

    if (to === 'cancelled') {
      switch (entity) {
        case 'sales_order': return 'sales.cancel';
        default: return null; // other machines: cancel needs no extra permission
      }
    }

    return machine.transitionPermissions[to] || null;
  }

  /** Combined STRICT gate: legality + permission (generic status routes). */
  static assertCanTransition(
    entity: WorkflowEntity,
    from: string,
    to: string,
    userPermissions: string[]
  ): void {
    this.assertTransition(entity, from, to);

    const required = this.requiredPermission(entity, from, to);
    if (required && !userPermissions.includes(required)) {
      throw AppError.forbidden(
        `You need the "${required}" permission to move a ${entity.replace(/_/g, ' ')} to "${to}"`,
        'TRANSITION_PERMISSION_DENIED'
      );
    }
  }

  /** Combined STOCK-MOVING gate: composite legality + permission. */
  static assertCanStockTransition(
    entity: WorkflowEntity,
    from: string,
    to: string,
    userPermissions: string[]
  ): void {
    this.assertStockTransition(entity, from, to);

    const required = this.requiredPermission(entity, from, to);
    if (required && !userPermissions.includes(required)) {
      throw AppError.forbidden(
        `You need the "${required}" permission to move a ${entity.replace(/_/g, ' ')} to "${to}"`,
        'TRANSITION_PERMISSION_DENIED'
      );
    }
  }
}
