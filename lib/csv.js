// RFC-4180 CSV builder. One shared function for every export so quoting is
// the same everywhere. No dependency.

function cell(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (/[",\n\r]/.test(text)) return '"' + text.replaceAll('"', '""') + '"';
  return text;
}

export function toCsv(headers, rows) {
  const lines = [headers.map(cell).join(',')];
  for (const row of rows) {
    lines.push(row.map(cell).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}
