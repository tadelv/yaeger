const AUTH_STORAGE_KEY = "yaegerAdminSecret";

export function getAdminSecret(): string {
  const existing = localStorage.getItem(AUTH_STORAGE_KEY);
  if (existing && existing.length >= 8) {
    return existing;
  }

  const value = window.prompt("Enter Yaeger admin password", "") || "";
  if (value.length >= 8) {
    localStorage.setItem(AUTH_STORAGE_KEY, value);
  }

  return value;
}

export function getBasicAuthHeaderValue(): string {
  const secret = getAdminSecret();
  return `Basic ${btoa(`admin:${secret}`)}`;
}
