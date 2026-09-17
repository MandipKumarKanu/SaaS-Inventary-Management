# Inventory SaaS Platform

## Master Product Requirements Document and AI Build Specification

## 0. Project Instruction

Build a production-ready, multi-tenant Inventory Management SaaS.

The application must allow one user account to manage and switch between multiple independent workspaces. Each workspace represents a separate company, business, or inventory environment.

The product must be built as a real SaaS application from the beginning.

Do not build a single-company application and add multi-tenancy later.

Do not generate a collection of disconnected CRUD pages.

The system must have:

* A clear multi-workspace architecture
* Strong workspace isolation
* Granular permissions
* A shared inventory engine
* Transaction-safe stock operations
* Subscription and usage management
* Auditability
* Real backend business logic
* Real database persistence
* Responsive business-focused UI
* A maintainable codebase

The AI coding agent must implement the application incrementally and verify each phase before continuing.

Do not generate fake functionality to make unfinished screens appear complete.

---

# 1. Product Concept

The product is an inventory management SaaS for businesses that need to manage products, stock, warehouses, purchasing, sales, transfers, returns, and inventory analytics.

The primary architecture is:

```text
User Account
    │
    ├── Workspace A
    │      ├── Members
    │      ├── Products
    │      ├── Warehouses
    │      ├── Inventory
    │      ├── Purchases
    │      ├── Sales
    │      └── Reports
    │
    ├── Workspace B
    │      ├── Members
    │      ├── Products
    │      ├── Warehouses
    │      ├── Inventory
    │      ├── Purchases
    │      ├── Sales
    │      └── Reports
    │
    └── Workspace C
```

One login can access multiple workspaces.

A user may have completely different permissions in each workspace.

Example:

```text
Mandy
│
├── ABC Traders
│   Owner
│
├── XYZ Electronics
│   Manager
│
└── Personal Inventory
    Owner
```

Workspace is the tenant boundary.

---

# 2. Technology Stack

Use this stack unless a documented technical reason requires otherwise.

## Frontend

* React
* Vite
* Tailwind CSS
* shadcn/ui
* React Router
* Axios
* Zustand only where global client state is actually required
* Recharts for charts
* Lucide React for icons

## Backend

* Node.js
* Express.js
* TypeScript preferred
* REST API
* Zod for request validation
* Service-based business logic

## Backend Services

Use Supabase for:

* PostgreSQL
* Authentication
* Row Level Security
* Storage
* Database functions where appropriate

The Node/Express backend remains responsible for application business logic.

Do not allow the React application to directly perform sensitive business operations against the database.

## Billing

Use Stripe where supported.

Keep billing-provider logic isolated from the core inventory system.

---

# 3. Architecture Principles

Use the following architectural layers:

```text
React UI
   ↓
API Client
   ↓
Express Routes
   ↓
Authentication Middleware
   ↓
Workspace Context
   ↓
Permission Middleware
   ↓
Controllers
   ↓
Services
   ↓
Repositories / Database Layer
   ↓
Supabase PostgreSQL
```

Business rules belong in services.

Controllers should remain thin.

React components must not contain critical inventory business logic.

Database queries should not be scattered throughout React components.

---

# 4. Account Model

A user account represents a person who logs into the platform.

The account does not represent a company.

A single account can belong to multiple workspaces.

Account-level information:

* User ID
* Name
* Email
* Avatar
* Authentication information
* Account preferences
* Account status
* Created date

Do not attach inventory data directly to a user.

Inventory belongs to a workspace.

---

# 5. Workspace Model

A workspace represents an independent business environment.

Examples:

* ABC Traders
* XYZ Electronics
* Kathmandu Warehouse
* Personal Inventory

Each workspace has independent:

* Products
* Product variants
* Categories
* Brands
* Suppliers
* Customers
* Warehouses
* Inventory
* Inventory transactions
* Reservations
* Purchases
* Sales
* Transfers
* Returns
* Reports
* Notifications
* Members
* Roles
* Permissions
* Settings
* Subscription
* Usage

Every workspace-owned record must contain:

```text
workspace_id
```

Never use the logged-in user's ID as the tenant identifier.

---

# 6. Workspace Switching

The application shell must provide a workspace switcher in the sidebar.

Example:

```text
┌──────────────────────────┐
│ ABC Traders           ▼  │
└──────────────────────────┘

Dashboard
Inventory
Products
Warehouses
Purchasing
Sales
Transfers
Returns
Suppliers
Customers
Reports
Analytics

──────────────────────────

Team
Settings
Billing
```

Clicking the workspace selector should display:

```text
Your Workspaces

✓ ABC Traders
  XYZ Electronics
  Personal Inventory

────────────────────

+ Create workspace
Manage workspaces
```

If a user has many workspaces, provide workspace search.

Switching workspace must update the active workspace context.

The current workspace should be reflected in the URL where practical.

Example:

```text
/app/abc-traders/dashboard
/app/abc-traders/inventory
/app/xyz-electronics/inventory
```

When switching workspace while viewing a page, preserve the destination if the user has permission.

Example:

```text
ABC Traders → Inventory
```

switching to:

```text
XYZ Electronics
```

should open:

```text
XYZ Electronics → Inventory
```

If the user does not have permission for the destination, redirect to an accessible page.

---

# 7. Workspace Isolation

Workspace isolation is a hard security requirement.

A user must never access another workspace's data unless they are explicitly a member of that workspace.

Do not trust:

* workspace IDs from the frontend
* URL workspace IDs
* query parameters
* request body workspace IDs
* database IDs
* product IDs
* warehouse IDs

The backend must verify:

```text
Authenticated User
        ↓
Workspace
        ↓
Membership
        ↓
Permission
        ↓
Operation
```

Example:

```text
GET /api/v1/workspaces/xyz/products
```

The server must verify that the authenticated user is a member of workspace `xyz`.

If not:

```text
403 Forbidden
```

Supabase RLS should provide an additional database-level isolation layer.

Test cross-workspace access explicitly.

---

# 8. Workspace Creation

Users with permission can create a workspace.

Workspace creation should:

1. Create workspace
2. Create owner membership
3. Assign Owner role
4. Create default workspace settings
5. Create default roles
6. Create subscription/trial record
7. Initialize usage tracking
8. Redirect the user into the new workspace

Where multiple records are required, use a transaction or an equivalent atomic workflow.

---

# 9. Workspace Invitations

Workspace owners and authorized administrators can invite other people.

Invitation fields:

* Email
* Workspace
* Invited by
* Role
* Optional custom permissions
* Status
* Expiration date
* Created date
* Accepted date

Invitation statuses:

```text
Pending
Accepted
Expired
Revoked
```

An invitation belongs to exactly one workspace.

Accepting an invitation creates a workspace membership.

Accepting an invitation must never give the user access to another workspace.

---

# 10. Members

A workspace member represents a user's access to one workspace.

Membership contains:

```text
user_id
workspace_id
status
```

A user can have multiple memberships:

```text
User
 ├── Workspace A → Owner
 ├── Workspace B → Manager
 └── Workspace C → Warehouse Staff
```

Membership is the basis for authorization.

---

# 11. Roles and Permissions

Use RBAC with granular permissions.

Default roles:

* Owner
* Admin
* Manager
* Warehouse Staff
* Purchasing Staff
* Sales Staff

Roles should be permission bundles.

Do not use role names as the only authorization mechanism.

Example permissions:

```text
products.view
products.create
products.update
products.archive

inventory.view
inventory.adjust
inventory.transfer
inventory.count

warehouses.view
warehouses.create
warehouses.update
warehouses.archive

purchases.view
purchases.create
purchases.approve
purchases.receive

sales.view
sales.create
sales.reserve
sales.fulfill
sales.cancel

transfers.view
transfers.create
transfers.approve
transfers.ship
transfers.receive

returns.view
returns.create
returns.approve
returns.inspect
returns.restock

reports.view
reports.export

team.view
team.invite
team.manage

roles.view
roles.manage

settings.view
settings.manage

billing.view
billing.manage
```

---

# 12. Multiple Permissions Per Person

The invitation/member interface must allow administrators to assign multiple permissions.

Example:

```text
Invite Member

Email
[ raj@example.com ]

Role
[ Custom ]

Inventory
☑ View
☑ Adjust
☑ Transfer
☐ Delete

Products
☑ View
☑ Create
☐ Edit
☐ Archive

Purchasing
☑ View
☑ Create
☐ Approve

Reports
☑ View
☐ Export

[ Send Invitation ]
```

A member can receive permissions through:

* Assigned roles
* Direct permissions, if enabled

The effective permission set should be calculated consistently.

Do not duplicate authorization logic in multiple places.

---

# 13. Authorization

Every protected API operation must verify:

1. Authentication
2. Workspace membership
3. Permission
4. Resource ownership
5. Business rules

Example:

```text
User
 ↓
Authenticated?
 ↓ yes
Member of workspace?
 ↓ yes
Has inventory.adjust?
 ↓ yes
Product belongs to workspace?
 ↓ yes
Stock operation valid?
 ↓ yes
Execute transaction
```

Frontend permission checks are only for UX.

They are never security controls.

---

# 14. SaaS Admin

Create a separate platform administration area.

Platform administrators can see:

* Organizations/workspaces
* Active workspaces
* Trial workspaces
* Paid workspaces
* Suspended workspaces
* Users
* Subscriptions
* Revenue information
* Usage
* Failed payments
* System health
* Platform audit logs

Workspace management:

* Search workspace
* View workspace
* View subscription
* Change plan
* Suspend workspace
* Reactivate workspace
* Cancel subscription
* View usage
* View billing status

Avoid exposing customer business data unnecessarily.

If impersonation is implemented, every impersonation action must be explicitly authorized and audited.

---

# 15. SaaS Billing

Subscriptions belong to workspaces.

A user's account does not have a combined subscription.

Example:

```text
ABC Traders
Business Plan

XYZ Electronics
Starter Plan

Personal Inventory
Free Plan
```

Usage limits apply independently to each workspace.

Plans should support:

* Free
* Starter
* Business
* Enterprise

Plan configuration must be stored in the database.

Do not hard-code limits throughout the application.

Plan configuration can include:

```text
price
billing_interval
user_limit
product_limit
warehouse_limit
storage_limit
api_limit
enabled_features
```

Support:

* Monthly billing
* Annual billing
* Free trials
* Upgrades
* Downgrades
* Cancellation
* Renewal
* Failed payments
* Retry periods
* Grace periods
* Reactivation

Use Stripe webhooks.

Webhook processing must be idempotent.

---

# 16. Feature Gating

Feature access must be enforced on the backend.

Frontend:

* Hide unavailable features
* Disable unavailable actions
* Display upgrade information

Backend:

* Reject unauthorized feature usage

Example:

```text
Starter plan
Forecasting unavailable
```

A request to:

```text
POST /api/v1/forecast
```

must be rejected even if the user manually calls the endpoint.

---

# 17. Usage Limits

Track usage per workspace.

Examples:

```text
Products
4,523 / 5,000

Users
8 / 10

Warehouses
2 / 3
```

Track:

* Users
* Products
* Warehouses
* Transactions
* Storage
* API requests

Warn before limits are reached.

Do not allow a limit to be bypassed by changing frontend state.

---

# 18. Onboarding

New workspaces should have a guided setup.

Steps:

```text
Create Workspace
       ↓
Business Settings
       ↓
Create Warehouse
       ↓
Add Products
       ↓
Import Inventory
       ↓
Invite Team
       ↓
Configure Inventory
       ↓
Finish
```

Support CSV import for:

* Products
* Suppliers
* Customers
* Opening inventory

Validate imports before committing them.

Show:

* Invalid rows
* Missing fields
* Duplicate SKUs
* Invalid quantities
* Invalid warehouse references

Never partially corrupt inventory because of an import error.

---

# 19. Product Management

Product fields:

* Name
* SKU
* Barcode
* Category
* Brand
* Description
* Unit
* Cost price
* Selling price
* Tax
* Reorder point
* Minimum stock
* Maximum stock
* Supplier
* Weight
* Dimensions
* Image
* Active/inactive
* Batch tracking
* Expiration tracking
* Serial tracking

Support variants.

Example:

```text
T-Shirt

Small / Red
Medium / Red
Large / Red
Small / Blue
```

Each variant has its own SKU.

SKU uniqueness must be enforced at database level within the workspace.

---

# 20. Inventory Engine

The inventory engine is the core business system.

The inventory ledger is the source of truth.

Do not maintain independent stock logic inside:

* Purchases
* Sales
* Transfers
* Returns
* Adjustments
* Stock counts

All stock-changing operations must use the same inventory service.

Every stock movement creates an immutable ledger transaction.

Transaction fields:

```text
workspace_id
product_id
warehouse_id
quantity_before
quantity_change
quantity_after
movement_type
reference_type
reference_id
user_id
created_at
notes
```

Movement types:

* Opening balance
* Purchase receipt
* Sale
* Customer return
* Transfer out
* Transfer in
* Adjustment
* Damaged
* Expired
* Stock count correction

---

# 21. Inventory Rules

Never trust a quantity sent by the client.

The server calculates:

```text
new_quantity
```

based on the current database state and operation.

Do not allow clients to directly set arbitrary stock balances.

Corrections must create new ledger transactions.

Historical transactions must be immutable.

The system should always be able to explain:

```text
Why is this product showing 137 units?
```

The answer must be reconstructable from the ledger.

---

# 22. Inventory Concurrency

Inventory operations must be safe when multiple users act simultaneously.

Example:

```text
User A sells 10
User B sells 15
```

at the same time.

The system must prevent inconsistent stock.

Use PostgreSQL transactions and appropriate row locking/transaction isolation.

A multi-step operation must either complete completely or fail completely.

Never allow:

```text
Transfer:
Source -10
Destination unchanged
```

because the second database operation failed.

---

# 23. Warehouses

Each workspace can have multiple warehouses according to its subscription limit.

Warehouse fields:

* Name
* Code
* Address
* Contact
* Manager
* Status

Optional locations:

```text
Warehouse
 └── Zone
      └── Rack
           └── Shelf
                └── Bin
```

Support inventory at warehouse level first.

Bin-level inventory can be enabled where required.

---

# 24. Stock Transfers

Transfers move inventory between warehouses.

Workflow:

```text
Draft
→ Requested
→ Approved
→ Picking
→ Shipped
→ In Transit
→ Received
→ Completed
```

Transfer contains:

* Source warehouse
* Destination warehouse
* Items
* Requested quantity
* Approved quantity
* Shipped quantity
* Received quantity
* Requested by
* Approved by
* Shipped by
* Received by
* Timestamps

Destination stock increases only after receiving.

Support partial transfers.

Transfer operations must be retry-safe.

---

# 25. Barcode Scanning

Provide a mobile-friendly barcode workflow.

Support:

* Device camera
* USB barcode scanners
* Bluetooth barcode scanners acting as keyboard input

Workflow:

```text
Scan
 ↓
Find SKU
 ↓
Show product
 ↓
Select warehouse
 ↓
Select operation
 ↓
Enter quantity
 ↓
Confirm
 ↓
Inventory transaction
```

Scanning must be fast enough for warehouse operations.

---

# 26. Suppliers

Supplier fields:

* Name
* Contact
* Email
* Phone
* Address
* Tax information
* Payment terms
* Lead time
* Minimum order quantity
* Currency
* Status

---

# 27. Purchase Orders

Purchase order fields:

* PO number
* Supplier
* Warehouse
* Items
* Quantities
* Unit cost
* Tax
* Discount
* Total
* Expected delivery
* Notes
* Status

Workflow:

```text
Draft
→ Pending Approval
→ Approved
→ Ordered
→ Partially Received
→ Received
→ Closed
```

Receiving must update inventory through the inventory engine.

Support partial receiving.

---

# 28. Reorder Management

When inventory reaches the reorder point, generate a reorder recommendation.

Consider:

* Current stock
* Reserved stock
* Incoming stock
* Reorder point
* Maximum stock
* Lead time
* Historical demand

Show the recommendation to authorized users.

Do not automatically create purchase orders unless the workspace explicitly enables automatic purchasing.

---

# 29. Customers

Customer fields:

* Name
* Email
* Phone
* Address
* Tax information
* Notes
* Status

Customer records belong to the workspace.

---

# 30. Sales Orders

Sales order fields:

* Customer
* Order number
* Items
* Quantity
* Price
* Tax
* Discount
* Total
* Shipping address
* Warehouse
* Status

Workflow:

```text
Draft
→ Confirmed
→ Reserved
→ Picking
→ Packed
→ Shipped
→ Delivered
→ Cancelled
```

Do not deduct inventory merely because a sales order exists.

Use reservation and fulfillment rules.

---

# 31. Order Fulfillment

Recommend a warehouse based on:

* Available stock
* Reserved stock
* Warehouse location
* Customer destination
* Fulfillment rules

Generate:

* Picking list
* Packing slip
* Shipment record

Keep shipping integrations separate from the inventory engine.

---

# 32. Returns

Workflow:

```text
Requested
→ Approved
→ Received
→ Inspection
→ Restock / Dispose
→ Refund
→ Completed
```

Track:

* Original order
* Product
* Quantity
* Reason
* Condition
* Inspection result
* Refund status
* Restocking decision

Only approved restock quantities can increase inventory.

---

# 33. Batch and Expiration Tracking

Support:

* Batch number
* Lot number
* Manufacturing date
* Expiration date
* Quantity
* Warehouse

Support:

* FIFO
* FEFO

FEFO prioritizes inventory with the earliest expiration date.

Expiration alerts:

* 30 days
* 14 days
* 7 days
* Expired

Alert thresholds should be configurable.

---

# 34. Serial Number Tracking

For serialized products:

Each physical item has a unique serial number.

Track:

* Serial number
* Product
* Warehouse
* Purchase
* Sale
* Transfer
* Return
* Current status

Prevent duplicate serial numbers.

---

# 35. Stock Counting

Support cycle counts.

Counts can be scheduled by:

* Warehouse
* Category
* SKU
* ABC class
* Frequency

Warehouse staff should enter physical quantities without seeing expected quantities before submitting the count.

Compare:

```text
System Quantity
vs
Physical Quantity
```

Calculate:

* Variance quantity
* Variance percentage
* Variance value

Require approval for configurable variance thresholds.

Approved adjustments must use the inventory ledger.

---

# 36. ABC Analysis

Classify inventory using configurable criteria.

Default:

```text
A = High contribution
B = Medium contribution
C = Low contribution
```

Show:

* Revenue contribution
* Inventory value
* Quantity
* Turnover
* Recommended stock policy

---

# 37. Demand Forecasting

Forecast future demand using historical data.

Display:

* Historical demand
* Forecast demand
* Risk/confidence indicator
* Current stock
* Incoming stock
* Projected stock
* Expected stockout date
* Suggested reorder quantity

Periods:

* 7 days
* 30 days
* 90 days
* Quarterly

Do not show a forecast when insufficient data exists.

Do not present estimates as guaranteed results.

---

# 38. Notifications

Notification center should support:

* Low stock
* Out of stock
* Stockout risk
* Overdue purchase order
* Overdue shipment
* Expiring inventory
* Stock discrepancy
* Pending approval
* Failed payment
* Subscription renewal
* Plan limit reached

Channels:

* In-app
* Email

Allow users to configure notification preferences.

---

# 39. Customer Dashboard

Show actual workspace data.

Metrics:

* Inventory value
* SKU count
* Unit count
* Low-stock products
* Out-of-stock products
* Purchase orders
* Sales orders
* Pending transfers
* Returns
* Inventory turnover
* Dead stock
* Warehouse distribution

Charts:

* Inventory value over time
* Sales
* Purchases
* Stock movement
* Inventory by warehouse
* Top products
* Low-stock trends

All metrics must respect permissions.

Never hard-code production statistics.

---

# 40. Reporting

Reports:

* Inventory valuation
* Inventory movement
* Stock aging
* Low stock
* Out of stock
* Dead stock
* Inventory turnover
* Purchases
* Supplier performance
* Sales fulfillment
* Returns
* Warehouse performance
* Stock discrepancies
* Expiring inventory

Filters:

* Date
* Warehouse
* Category
* Supplier
* Product

Exports:

* CSV
* Excel
* PDF

Large reports should run as background jobs.

---

# 41. Audit Logs

Maintain immutable audit logs.

Track:

* Login
* Logout
* Product creation
* Product update
* Product archive
* Inventory adjustment
* Purchase creation
* Purchase approval
* Transfer approval
* User invitation
* User removal
* Role changes
* Permission changes
* Settings changes
* Subscription changes

Store:

```text
workspace_id
user_id
action
entity
entity_id
previous_value
new_value
ip_address
user_agent
created_at
```

Do not allow normal users to edit audit logs.

Do not log passwords, tokens, payment details, or secrets.

---

# 42. Search

Provide global search for:

* Product name
* SKU
* Barcode
* Supplier
* Purchase order
* Sales order
* Transfer
* Customer
* Serial number

Search must be:

* Workspace-scoped
* Permission-aware
* Server-side

Do not load entire datasets into the browser to implement search.

---

# 43. Import System

CSV import workflow:

```text
Upload
 ↓
Detect columns
 ↓
Map fields
 ↓
Validate
 ↓
Preview
 ↓
Confirm
 ↓
Process
 ↓
Result
```

For large imports:

* Process asynchronously
* Track progress
* Store errors
* Allow users to download failed rows

Imports must be safe and repeatable.

---

# 44. API Design

Use:

```text
/api/v1
```

Routes:

```text
/auth
/users
/workspaces
/workspaces/:workspaceId/members
/workspaces/:workspaceId/roles

/products
/categories
/warehouses
/inventory
/inventory/transactions

/suppliers
/customers

/purchase-orders
/goods-receipts

/sales-orders
/transfers
/returns

/reports
/notifications

/subscription
/usage
```

API requirements:

* Authentication
* Workspace authorization
* Permission checks
* Validation
* Pagination
* Filtering
* Sorting
* Rate limiting
* Consistent errors

Use meaningful error codes.

Example:

```json
{
  "success": false,
  "error": {
    "code": "INSUFFICIENT_STOCK",
    "message": "The requested quantity is greater than available stock."
  }
}
```

Do not expose raw database errors.

---

# 45. Database Schema

Use Supabase PostgreSQL.

Core tables:

```text
users

workspaces
workspace_members
workspace_invitations

roles
permissions
role_permissions
member_roles
member_permissions

subscription_plans
subscriptions
usage_records

products
product_variants
categories
brands

suppliers
customers

warehouses
warehouse_locations

inventory
inventory_transactions
inventory_reservations

purchase_orders
purchase_order_items
goods_receipts
goods_receipt_items

sales_orders
sales_order_items

stock_transfers
stock_transfer_items

returns
return_items

batches
serial_numbers

inventory_counts
inventory_count_items

notifications
audit_logs

api_keys
webhooks
```

Every workspace-owned table must contain:

```text
workspace_id
```

Add:

* Foreign keys
* Unique constraints
* Check constraints
* Indexes
* Appropriate cascading rules

Do not cascade-delete historical inventory or audit information casually.

---

# 46. Database Constraints

Use PostgreSQL constraints for rules that should never be violated.

Examples:

* SKU uniqueness within workspace
* Barcode uniqueness where required
* Valid foreign keys
* Valid quantities
* Valid statuses
* Valid relationships

Database integrity should not depend entirely on Express code.

---

# 47. Row Level Security

Use Supabase RLS to reinforce workspace isolation.

Policies must ensure that a user can only access records belonging to workspaces where they have valid membership.

Do not assume that Express authorization alone is sufficient.

Do not expose the Supabase service role key to the browser.

Never put privileged database credentials in frontend code.

---

# 48. Frontend Structure

Use feature-based organization.

Suggested structure:

```text
src/
  app/
  routes/
  layouts/

  components/
    ui/
    common/

  features/
    auth/
    workspace/
    dashboard/
    products/
    inventory/
    warehouses/
    purchasing/
    sales/
    transfers/
    returns/
    suppliers/
    customers/
    reports/
    analytics/
    team/
    billing/
    settings/

  services/
  hooks/
  stores/
  lib/
  types/
```

Keep API services separate from UI components.

Avoid giant page components.

---

# 49. Frontend State

Use local React state for local UI state.

Use Zustand only for genuinely global client state such as:

* Active workspace context
* User session metadata
* Global UI state

Do not put all server data into Zustand.

Server data should remain managed through API fetching/caching patterns appropriate to the application.

Avoid unnecessary global state.

---

# 50. UI Components

Build reusable components for:

* Data tables
* Filters
* Search
* Pagination
* Forms
* Dialogs
* Drawers
* Dropdowns
* Confirmation dialogs
* Status badges
* Cards
* Charts
* Toasts
* Alerts
* Empty states
* Loading skeletons
* Error states

Use shadcn/ui components as the base.

Do not create a custom implementation when an existing shadcn component already solves the problem unless customization requires it.

---

# 51. UX Principles

The application should feel like a serious business application.

Prioritize:

* Clear navigation
* Fast workflows
* Readable tables
* Useful filtering
* Clear statuses
* Consistent forms
* Good keyboard support
* Good mobile workflows
* Clear confirmation for destructive actions

Avoid:

* Excessive animation
* Decorative gradients everywhere
* Giant cards for simple information
* Fake metrics
* Unnecessary popups
* Overly complicated navigation
* Generic placeholder copy

The interface should favor usefulness over decoration.

---

# 52. Responsive Design

Support:

* Desktop
* Laptop
* Tablet
* Mobile

Warehouse workflows should be mobile-friendly.

Barcode scanning should support one-handed use.

Do not simply overflow desktop tables on mobile.

Use responsive alternatives such as:

* Cards
* Drawers
* Mobile filters
* Compact lists
* Bottom sheets where appropriate

---

# 53. Accessibility

Follow WCAG-oriented practices.

Support:

* Keyboard navigation
* Proper labels
* Visible focus states
* Semantic HTML
* Sufficient contrast
* Screen-reader-friendly controls
* Accessible dialogs
* Accessible tables

Do not use color as the only indicator of state.

---

# 54. Loading and Error States

Every major page must handle:

* Loading
* Empty
* Error
* Permission denied
* Success

Example:

```text
No products yet.

Add your first product or import products from CSV.
```

Permission:

```text
You don't have permission to view this page.
```

Errors should explain what the user can do next when possible.

---

# 55. Soft Deletion

Do not physically delete business records when doing so would destroy historical relationships.

Use appropriate archive/deactivation fields such as:

```text
is_active
archived_at
deleted_at
```

Inventory transactions and audit logs are immutable.

Historical records must remain understandable after products, users, suppliers, or warehouses are archived.

---

# 56. Background Jobs

Use background processing for:

* Email notifications
* Scheduled alerts
* CSV imports
* Report generation
* Forecast calculations
* Expiration checks
* Reorder recommendations
* Subscription synchronization

Jobs should be:

* Retryable
* Observable
* Idempotent where possible

Do not block normal API requests with expensive processing.

---

# 57. Integrations

Create an integration layer.

Potential integrations:

* Stripe
* E-commerce platforms
* Accounting software
* Shipping providers
* Email providers
* Payment providers
* Barcode hardware

Keep integration code isolated.

The inventory engine must not depend directly on a specific external provider.

---

# 58. Security

Implement:

* Authentication
* Authorization
* Workspace isolation
* Supabase RLS
* Input validation
* Rate limiting
* Secure headers
* XSS protection
* CSRF protection where applicable
* File validation
* Secret management
* Safe error handling

Never expose:

* Passwords
* Tokens
* Private keys
* Stripe secrets
* Supabase service keys
* Internal credentials

Never return sensitive internal information in API responses.

---

# 59. Observability

Track:

* API failures
* Slow requests
* Database errors
* Authentication failures
* Failed jobs
* Payment webhook failures
* Subscription synchronization failures

Use structured logging.

Logs must not contain secrets or sensitive customer information.

---

# 60. Testing Strategy

Critical business logic must have automated tests.

## Authentication

Test:

* Signup
* Login
* Logout
* Password reset
* Organization/workspace switching

## Workspace Security

Test:

* Accessing own workspace
* Accessing another workspace
* Changing workspace ID
* Changing product ID
* Changing warehouse ID
* Unauthorized member access

## Permissions

Test:

* Role permissions
* Direct permissions
* Permission denial
* Admin operations
* Team management

## Inventory

Test:

* Opening balance
* Purchase receiving
* Sale
* Reservation
* Transfer
* Return
* Adjustment
* Stock counting
* Concurrent stock changes

## Billing

Test:

* Trial
* Upgrade
* Downgrade
* Cancellation
* Failed payment
* Webhook duplication
* Webhook retry
* Limit enforcement

Critical inventory operations must have tests before being marked complete.

---

# 61. Development Phases

Do not implement the entire application in one generation.

## Phase 1: Foundation

Implement:

* React/Vite setup
* Tailwind
* shadcn/ui
* Express
* Supabase
* Authentication
* Account model
* Workspace model
* Memberships
* Workspace switching
* Invitations
* Roles
* Permissions
* Tenant isolation
* Basic SaaS admin

### Phase 1 completion criteria

Before moving forward:

* A user can register.
* A user can create a workspace.
* A user can create multiple workspaces.
* A user can switch workspaces.
* A user can invite another user.
* Invitations work.
* Permissions work.
* Cross-workspace access is blocked.
* RLS is configured.
* Basic automated authorization tests pass.

---

# 62. Phase 2: Inventory Core

Implement:

* Products
* Categories
* Product variants
* Warehouses
* Inventory
* Inventory ledger
* Stock adjustments
* Dashboard

### Completion criteria

Verify:

* Stock quantities are correct.
* Every movement creates a ledger entry.
* Ledger entries cannot be edited.
* Stock cannot become invalid through normal operations.
* Concurrent changes are handled safely.
* All inventory operations are workspace-scoped.

---

# 63. Phase 3: Warehouse Operations

Implement:

* Barcode scanning
* Stock transfers
* Receiving
* Cycle counting
* Batch tracking
* Expiration tracking

Verify all operations against the inventory engine.

---

# 64. Phase 4: Purchasing and Sales

Implement:

* Suppliers
* Purchase orders
* Goods receiving
* Customers
* Sales orders
* Inventory reservation
* Fulfillment
* Returns

Do not duplicate inventory calculations in these modules.

---

# 65. Phase 5: Analytics

Implement:

* Reports
* Inventory valuation
* Stock aging
* ABC analysis
* Inventory turnover
* Dead stock
* Expiration analytics
* Demand forecasting

Only calculate analytics from real workspace data.

---

# 66. Phase 6: SaaS Monetization

Implement:

* Subscription plans
* Stripe integration
* Trials
* Feature gating
* Usage limits
* Upgrade
* Downgrade
* Cancellation
* Payment webhooks
* Billing dashboard

Verify billing state on the backend.

---

# 67. Phase 7: Scale and Integrations

Implement:

* Public API
* API keys
* Webhooks
* Background workers
* E-commerce integrations
* Shipping integrations
* Caching
* Advanced monitoring

Only optimize where actual application requirements justify it.

---

# 68. MVP

The first usable version should include:

### Account

* Signup
* Login
* Password reset

### Workspace

* Create workspace
* Switch workspace
* Workspace settings
* Invite members
* Roles
* Multiple permissions

### Inventory

* Products
* Categories
* Warehouses
* Inventory
* Inventory ledger
* Stock adjustments
* Transfers

### Purchasing

* Suppliers
* Purchase orders
* Receiving

### Dashboard

* Inventory summary
* Low stock
* Basic stock movement

### Reporting

* Basic inventory report
* Basic movement report
* CSV export

### Security

* Workspace isolation
* RBAC
* Audit logs

### SaaS

* Trial architecture
* Plans
* Usage limits

Do not delay the MVP for advanced forecasting or complex integrations.

---

# 69. AI Coding Agent Rules

The AI agent must behave like an engineer working inside an existing codebase.

Before making changes:

1. Inspect the existing project structure.
2. Inspect related files.
3. Understand existing patterns.
4. Reuse existing components.
5. Reuse existing services.
6. Check database relationships.
7. Check workspace isolation.
8. Check permissions.
9. Check whether the change affects inventory.
10. Determine whether a database transaction is required.

Then implement the smallest complete change.

After implementation:

1. Run the relevant checks/tests.
2. Fix errors.
3. Check related flows.
4. Verify authorization.
5. Verify workspace isolation.
6. Verify UI states.
7. Continue only after the feature is stable.

Do not rewrite unrelated working code.

Do not replace working architecture simply because another implementation is shorter.

---

# 70. AI Agent Rules for Code Quality

The agent must:

* Reuse existing components.
* Reuse existing services.
* Avoid duplicate API endpoints.
* Avoid duplicate database logic.
* Avoid duplicate validation.
* Keep business logic in services.
* Keep controllers small.
* Keep React components focused.
* Use meaningful names.
* Keep types consistent.
* Validate external input.
* Handle errors explicitly.
* Avoid unnecessary dependencies.

Do not create abstractions that have no practical use.

Do not create huge files when functionality can reasonably be separated by domain.

---

# 71. AI Agent Rules for Data

Never fabricate production data.

Never hard-code:

* Inventory
* Sales
* Revenue
* Product counts
* Warehouse counts
* Customer counts
* Forecasts
* Subscription state
* Payment state

If sample data is required, create an explicit demo/seed mechanism.

Production code must use real database data.

---

# 72. AI Agent Rules for Inventory

The agent must never bypass the inventory service.

Any operation that changes stock must:

1. Authenticate the user.
2. Resolve workspace.
3. Verify membership.
4. Verify permission.
5. Validate the operation.
6. Check current inventory.
7. Execute a database transaction.
8. Update inventory state.
9. Create ledger transaction.
10. Create audit record where appropriate.
11. Return the resulting state.

Do not update stock directly from the frontend.

Do not create separate stock formulas inside individual modules.

---

# 73. AI Agent Rules for Billing

Never treat billing as a visual feature.

Subscription state must come from trusted backend/database state.

Stripe webhooks must update subscription state.

Webhook processing must handle:

* Duplicate events
* Out-of-order events
* Failed processing
* Retries

Plan limits must be enforced by the backend.

---

# 74. AI Agent Rules for UI

Do not generate random UI for every page.

Maintain a consistent visual system.

Reuse:

* Sidebar
* Header
* Workspace switcher
* Tables
* Forms
* Dialogs
* Filters
* Status badges
* Empty states
* Loading states

Pages should look like parts of the same product.

Do not add unnecessary gradients, animations, illustrations, or decorative elements.

Use shadcn/ui consistently.

---

# 75. AI Agent Rules for Incomplete Features

Never fake a completed feature.

If a backend capability is not implemented:

Do not:

* Return hard-coded results
* Pretend an operation succeeded
* Display fake statistics
* Create fake API responses

Instead:

* Implement the backend correctly, or
* Clearly mark the feature as unavailable/in development.

A partially implemented real feature is preferable to a visually complete fake feature.

---

# 76. Business Workflow Integrity

Important workflows must have explicit state transitions.

Example:

```text
Purchase Order

Draft
 ↓
Pending Approval
 ↓
Approved
 ↓
Ordered
 ↓
Partially Received
 ↓
Received
 ↓
Closed
```

Do not allow arbitrary status changes from the frontend.

The server must validate state transitions.

Example:

```text
Draft → Received
```

should not be possible if the required receiving operation has not happened.

---

# 77. Auditability

For every important business operation, the system should be able to answer:

```text
Who did it?
What did they do?
Which workspace?
Which record?
When?
What changed?
Why?
```

This is especially important for:

* Inventory
* Permissions
* Users
* Purchases
* Sales
* Transfers
* Returns
* Billing

---

# 78. Definition of Done

A feature is not complete merely because the UI exists.

A feature is complete when:

* UI exists
* API exists
* Database schema exists where required
* Validation exists
* Authorization exists
* Workspace isolation is enforced
* Business rules work
* Error states work
* Loading states work
* Empty states work
* Audit requirements are handled
* Relevant tests pass
* No fake data is required
* The feature works with real database data

For inventory-changing features, database transaction safety is also required.

---

# 79. Final Product Rules

The following rules override convenience:

1. Workspace isolation is mandatory.
2. Server-side authorization is mandatory.
3. Inventory correctness is mandatory.
4. The inventory ledger is the source of truth.
5. Stock changes must be atomic.
6. Client-provided stock quantities cannot be trusted.
7. Client-provided workspace IDs cannot be trusted.
8. Billing must be enforced server-side.
9. Feature limits must be enforced server-side.
10. Audit logs must be protected.
11. Historical inventory must remain traceable.
12. Do not fabricate production data.
13. Do not create fake APIs.
14. Do not bypass the inventory engine.
15. Do not duplicate business logic.
16. Do not load entire datasets into the browser.
17. Do not allow arbitrary business status transitions.
18. Use PostgreSQL constraints where appropriate.
19. Use transactions for multi-step inventory operations.
20. Test cross-workspace access.
21. Test permission boundaries.
22. Build incrementally.
23. Verify each phase before starting the next.
24. Preserve working code unless a change is actually required.
25. Prefer simple, understandable implementations over unnecessary complexity.

---

# 80. Core Product Model

The final architecture should conceptually remain:

```text
                    USER ACCOUNT
                         │
             ┌───────────┼───────────┐
             │           │           │
             ▼           ▼           ▼
         WORKSPACE A WORKSPACE B WORKSPACE C
             │           │           │
             │           │           │
        ┌────┴────┐ ┌────┴────┐ ┌────┴────┐
        │ Members │ │ Members │ │ Members │
        │ Roles   │ │ Roles   │ │ Roles   │
        │ Perms   │ │ Perms   │ │ Perms   │
        └────┬────┘ └────┬────┘ └────┬────┘
             │           │           │
             ▼           ▼           ▼
        INVENTORY    INVENTORY    INVENTORY
        PRODUCTS     PRODUCTS     PRODUCTS
        WAREHOUSES   WAREHOUSES   WAREHOUSES
        PURCHASES    PURCHASES    PURCHASES
        SALES        SALES        SALES
        REPORTS      REPORTS      REPORTS
```

The account provides identity.

The workspace provides isolation.

Membership provides access.

Roles and permissions provide authorization.

The inventory ledger provides stock truth.

The database provides persistence and integrity.

The Node/Express backend provides business logic.

Supabase provides PostgreSQL, authentication, storage, and database-level security.

React provides the application interface.

The AI coding agent must preserve these boundaries throughout the implementation.
