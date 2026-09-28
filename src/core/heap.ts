// Binary min-heap ordered by (t, pri, seq): deterministic event ordering.
export interface QItem { t: number; pri: number; seq: number; kind: string; data: any }

function less(a: QItem, b: QItem): boolean {
  if (a.t !== b.t) return a.t < b.t;
  if (a.pri !== b.pri) return a.pri < b.pri;
  return a.seq < b.seq;
}

export class Heap {
  items: QItem[] = [];
  get size(): number { return this.items.length; }
  peek(): QItem | undefined { return this.items[0]; }
  push(x: QItem): void {
    const a = this.items; a.push(x);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!less(a[i], a[p])) break;
      [a[i], a[p]] = [a[p], a[i]]; i = p;
    }
  }
  pop(): QItem | undefined {
    const a = this.items; if (!a.length) return undefined;
    const top = a[0]; const last = a.pop()!;
    if (a.length) {
      a[0] = last; let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < a.length && less(a[l], a[m])) m = l;
        if (r < a.length && less(a[r], a[m])) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]]; i = m;
      }
    }
    return top;
  }
}
