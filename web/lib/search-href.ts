import type { StaffRole } from "@pearl/shared";

export interface SearchHit {
  type: string;
  id: string;
}

/** Where a search result opens. Reception can't open lead pages: a lead becomes a patient registration. */
export function searchHref(hit: SearchHit, role: StaffRole): string {
  if (hit.type === "lead") return role === "receptionist" ? `/patients/new?lead=${hit.id}` : `/leads/${hit.id}`;
  return `/patients/${hit.id}`;
}

/** Roles whose top search bar looks up people (patients and/or leads). */
export function canSearchPeople(role: StaffRole): boolean {
  return role === "receptionist" || role === "admin" || role === "sales_manager";
}
