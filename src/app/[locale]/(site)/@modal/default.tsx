/**
 * Nothing renders in the modal slot unless a route is intercepted into it.
 * Without this file Next.js has no fallback for the slot and a hard navigation
 * to any page in this group 404s.
 */
export default function ModalDefault() {
  return null;
}
