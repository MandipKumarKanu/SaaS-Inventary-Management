import { useWorkspaceStore } from '../store/useWorkspaceStore';

export const CURRENCY_SYMBOLS = {
  NPR: 'रू',
  INR: '₹',
  USD: '$',
  EUR: '€',
  GBP: '£',
  AUD: 'A$',
  CAD: 'C$',
  AED: 'AED',
  SGD: 'S$',
  JPY: '¥',
};

/**
 * Get currency symbol for a currency code (e.g. NPR -> "रू", USD -> "$", EUR -> "€")
 */
export function getCurrencySymbol(code = 'NPR') {
  if (!code) return 'रू';
  const upper = String(code).toUpperCase();
  return CURRENCY_SYMBOLS[upper] || upper || 'रू';
}

/**
 * Get active workspace currency symbol or fallback
 */
export function getWorkspaceCurrencySymbol(workspaceOverride = null) {
  const ws = workspaceOverride || useWorkspaceStore.getState().activeWorkspace;
  const settings = ws?.settings || {};
  if (settings.currency_symbol) return settings.currency_symbol;
  if (settings.currency) return getCurrencySymbol(settings.currency);
  if (settings.default_currency) return getCurrencySymbol(settings.default_currency);
  return 'रू';
}

/**
 * Get active workspace currency code (e.g. "NPR")
 */
export function getWorkspaceCurrencyCode(workspaceOverride = null) {
  const ws = workspaceOverride || useWorkspaceStore.getState().activeWorkspace;
  const settings = ws?.settings || {};
  return settings.currency || settings.default_currency || 'NPR';
}

/**
 * Formats an amount using the workspace currency or a custom symbol.
 * Example: formatCurrency(1250) => "रू1,250.00"
 */
export function formatCurrency(amount, customSymbol = null, workspaceOverride = null) {
  const num = Number(amount) || 0;
  const symbol = customSymbol !== null && customSymbol !== undefined
    ? customSymbol
    : getWorkspaceCurrencySymbol(workspaceOverride);

  const formattedNum = num.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return `${symbol}${formattedNum}`;
}

/**
 * React Hook for component rendering that re-evaluates when activeWorkspace changes
 */
export function useCurrency() {
  const activeWorkspace = useWorkspaceStore((state) => state.activeWorkspace);
  const settings = activeWorkspace?.settings || {};
  const currencyCode = settings.currency || settings.default_currency || 'NPR';
  const symbol = settings.currency_symbol || getCurrencySymbol(currencyCode);

  const format = (amount, overrideSymbol = null) => {
    const num = Number(amount) || 0;
    const sym = overrideSymbol !== null && overrideSymbol !== undefined ? overrideSymbol : symbol;
    const formattedNum = num.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return `${sym}${formattedNum}`;
  };

  return {
    symbol,
    currencyCode,
    format,
  };
}
