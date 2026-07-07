import { and, eq } from 'drizzle-orm';
import type { Tx } from '../db';
import { knowledgeBaseItems } from '../db/schema';

export interface KbItemLite {
  id: string;
  type: string;
  question: string | null;
  answer: string | null;
  structuredData: unknown;
}

/**
 * Loads the tenant's active KB and renders it as grounding context.
 * MVP strategy = context-stuffing the whole curated KB (cheaper + more accurate
 * than RAG for small KBs). Swap to pgvector hybrid retrieval when a tenant's KB
 * outgrows the context budget.
 */
export async function loadKb(tx: Tx, tenantId: string): Promise<KbItemLite[]> {
  return tx
    .select({
      id: knowledgeBaseItems.id,
      type: knowledgeBaseItems.type,
      question: knowledgeBaseItems.question,
      answer: knowledgeBaseItems.answer,
      structuredData: knowledgeBaseItems.structuredData,
    })
    .from(knowledgeBaseItems)
    .where(and(eq(knowledgeBaseItems.tenantId, tenantId), eq(knowledgeBaseItems.isActive, true)));
}

export function renderKbContext(items: KbItemLite[]): string {
  return items
    .map((it) => {
      const facts = it.structuredData ? ` [facts: ${JSON.stringify(it.structuredData)}]` : '';
      return `- (${it.id}) ${it.type.toUpperCase()}: ${it.question ?? ''} => ${it.answer ?? ''}${facts}`;
    })
    .join('\n');
}

/** Pulls all numeric prices from KB `price` rows — used by the validation pass. */
export function kbPrices(items: KbItemLite[]): number[] {
  const prices: number[] = [];
  for (const it of items) {
    const sd = it.structuredData as { price?: number } | null;
    if (sd && typeof sd.price === 'number') prices.push(sd.price);
    // also parse any ₹ amounts embedded in the answer text
    for (const m of (it.answer ?? '').matchAll(/₹?\s?(\d{2,7})/g)) {
      const n = parseInt(m[1], 10);
      if (n >= 50) prices.push(n);
    }
  }
  return prices;
}
