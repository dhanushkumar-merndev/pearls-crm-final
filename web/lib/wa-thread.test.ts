import { describe, expect, it } from "vitest";
import { mergeNewest, type ThreadPage } from "./wa-thread";

type Msg = { id: string; created_at: string; status?: string };
type Page = ThreadPage<Msg> & { opted_out?: boolean };

// m(5) is newer than m(4); ids sort the same way as times.
const m = (n: number, status = "sent"): Msg => ({ id: `id-${String(n).padStart(3, "0")}`, created_at: new Date(Date.UTC(2026, 10, 1, 0, n)).toISOString(), status });
const page = (from: number, to: number, next_cursor: string | null, extra: Partial<Page> = {}): Page => {
  const items: Msg[] = [];
  for (let n = from; n >= to; n--) items.push(m(n));
  return { items, next_cursor, ...extra };
};
const ids = (p: Page) => p.items.map((x) => Number(x.id.slice(3)));

describe("mergeNewest", () => {
  it("no data yet: just the fresh page", () => {
    const fresh = page(10, 1, null);
    expect(mergeNewest<Page>(undefined, fresh)).toEqual({ pages: [fresh], pageParams: [null] });
  });

  it("a new message joins the newest page; older pages stay as they were", () => {
    const old = { pages: [page(10, 8, "c8"), page(7, 5, "c5")], pageParams: [null, "c8"] };
    const fresh = page(11, 9, "c9", { opted_out: true });
    const out = mergeNewest<Page>(old, fresh);
    expect(ids(out.pages[0]!)).toEqual([11, 10, 9, 8]);
    expect(out.pages[0]!.next_cursor).toBe("c8"); // page 2 still starts after 8
    expect(out.pages[0]!.opted_out).toBe(true); // head fields come from the fresh page
    expect(ids(out.pages[1]!)).toEqual([7, 6, 5]);
    expect(out.pageParams).toEqual([null, "c8"]);
  });

  it("a fresh copy replaces the shown one (delivery tick), with no duplicates", () => {
    const old = { pages: [page(3, 1, null)], pageParams: [null] };
    const fresh: Page = { items: [m(3, "read"), m(2), m(1)], next_cursor: null };
    const out = mergeNewest<Page>(old, fresh);
    expect(ids(out.pages[0]!)).toEqual([3, 2, 1]);
    expect(out.pages[0]!.items[0]!.status).toBe("read");
  });

  it("a message also in an older page moves to the newest page only once", () => {
    const old = { pages: [page(10, 8, "c8"), page(7, 5, "c5")], pageParams: [null, "c8"] };
    const fresh = page(12, 7, "c7");
    const out = mergeNewest<Page>(old, fresh);
    const all = out.pages.flatMap(ids);
    expect(all).toEqual([12, 11, 10, 9, 8, 7, 6, 5]);
    expect(new Set(all).size).toBe(all.length);
  });

  it("more new messages than one page holds: only the fresh page is kept (no hole)", () => {
    const old = { pages: [page(10, 8, "c8"), page(7, 5, "c5")], pageParams: [null, "c8"] };
    const fresh = page(50, 21, "c21");
    expect(mergeNewest<Page>(old, fresh)).toEqual({ pages: [fresh], pageParams: [null] });
  });

  it("whole chat fits one page: everything is loaded, no cursor", () => {
    const old = { pages: [page(20, 1, null)], pageParams: [null] };
    const fresh = page(35, 6, "c6");
    const out = mergeNewest<Page>(old, fresh);
    expect(ids(out.pages[0]!)).toHaveLength(35);
    expect(out.pages[0]!.next_cursor).toBeNull();
  });
});
