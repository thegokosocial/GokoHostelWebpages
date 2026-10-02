import { payableBillActivity } from "@/lib/payableBillActivity";

export const billMoney = (amount: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(amount / 100);
const recordedAt = (value: string) => Number.isNaN(Date.parse(value)) ? "Time unavailable" : new Date(value).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });

export function BillInvoiceLinks({ links }: { links?: string }) {
  const valid = (links || "").split(",").filter(link => /^https:\/\//i.test(link));
  if (!valid.length) return null;
  return <div className="mt-2 flex flex-wrap gap-3">{valid.map((link, index) => <a key={`${link}-${index}`} className="text-xs text-brand-green underline" href={link} target="_blank" rel="noopener noreferrer">Invoice {index + 1}</a>)}</div>;
}

export function PayableBillHistory({ bill, expanded = false }: { bill: any; expanded?: boolean }) {
  const events = payableBillActivity(bill);
  return <details key={bill.id} open={expanded || undefined} className="mt-5 border-t pt-4">
    <summary className="cursor-pointer text-sm font-semibold">Activity history · {bill.notes?.length || 0} notes · {bill.payments?.length || 0} payments · {bill.adjustments?.length || 0} total changes</summary>
    {events.length ? <ol className="mt-3 space-y-3">{events.map(event => <li key={event.key} className="rounded-lg border border-brand-mist p-3 text-sm" data-activity-kind={event.kind}>
      <p className="font-semibold">{event.kind === "note" ? "Note" : event.kind === "adjustment" ? `Total increased by ${billMoney(event.amount || 0)}` : `${event.reversed ? "Reversed payment" : "Payment"} · ${billMoney(event.amount || 0)}`}</p>
      <p className="mt-1 text-xs text-muted-foreground">{event.actor || "Unknown user"} · {recordedAt(event.timestamp)} IST</p>
      {event.kind === "payment" && <p className="mt-1 text-xs">Payment date: {event.date} · {event.method} · {event.account}{event.reversed ? " · Excluded from paid total" : ""}</p>}
      <p className="mt-2 whitespace-pre-wrap break-words">{event.text}</p>
      {event.kind === "payment" && <BillInvoiceLinks links={event.links} />}
    </li>)}</ol> : <p className="mt-3 text-sm text-muted-foreground">No activity yet.</p>}
  </details>;
}
