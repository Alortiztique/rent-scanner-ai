export function formatCurrency(amount: number, currency: string, symbol: string): string {
  if (currency === 'COP') {
    return `${symbol}${amount.toLocaleString('es-CO')}`;
  }
  if (currency === 'JPY') {
    return `${symbol}${amount.toLocaleString('ja-JP')}`;
  }
  if (currency === 'GBP') {
    return `£${amount.toLocaleString('en-GB')}`;
  }
  if (currency === 'EUR') {
    return `€${amount.toLocaleString('de-DE')}`;
  }
  if (currency === 'AED') {
    return `AED ${amount.toLocaleString('en-US')}`;
  }
  return `$${amount.toLocaleString('en-US')}`;
}

export function formatUsd(amount: number): string {
  return `$${amount.toLocaleString('en-US')}`;
}
