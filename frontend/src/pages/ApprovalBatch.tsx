import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { approvalBatchesApi, type ApprovalBatchDetail } from '@/lib/api';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { OrderStatusBadge } from '@/components/OrderStatusBadge';
import type { OrderStatus } from '@/lib/types';
import { CheckCircle2 } from 'lucide-react';

function EmailNotice({ email }: { email: ApprovalBatchDetail['email'] }) {
  const recipients = email.recipients?.length ? ` to ${email.recipients.join(', ')}` : '';
  switch (email.status) {
    case 'sent':
      return <Badge tone="success">Email notification sent{recipients}</Badge>;
    case 'failed':
      return (
        <Badge tone="danger" title={email.error ?? undefined}>
          Email notification failed
        </Badge>
      );
    case 'not_configured':
      return <Badge tone="muted">No email sent (email isn't set up yet)</Badge>;
    default:
      return <Badge tone="warning">Email notification sending</Badge>;
  }
}

// Permanent record of one bulk approval -- what the notification email links
// to, and what Daniel/Shonrei can reopen later to see exactly what was
// approved together.
export default function ApprovalBatch() {
  const { batchId } = useParams<{ batchId: string }>();
  const { data, isLoading, error } = useQuery({
    queryKey: ['approval-batch', batchId],
    queryFn: () => approvalBatchesApi.get(batchId!),
    enabled: !!batchId,
  });

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex max-w-3xl flex-col gap-4">
        <Link to="/approvals/history" className="text-sm text-[var(--accent)] hover:underline">
          Back to approval history
        </Link>
        <Card className="p-6 text-sm text-[var(--danger)]">Couldn't load this approval: {(error as Error | null)?.message ?? 'not found'}</Card>
      </div>
    );
  }

  const totalQty = data.orders.reduce((sum, o) => sum + o.total_quantity, 0);

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <Link to="/approvals/history" className="text-sm text-[var(--accent)] hover:underline">
        Back to approval history
      </Link>

      <div className="flex items-start gap-3">
        <CheckCircle2 className="mt-0.5 h-6 w-6 flex-shrink-0 text-[var(--success)]" />
        <div>
          <h1 className="text-lg font-semibold">{data.subject}</h1>
          <p className="text-sm text-[var(--muted-foreground)]">
            Approved by {data.approved_by?.full_name || data.approved_by?.email || 'an approver'} at {data.time} on {data.date} ({data.timezone}, New
            Zealand time)
          </p>
        </div>
      </div>

      <Card className="flex flex-wrap items-center gap-x-6 gap-y-2 p-4 text-sm">
        <div>
          <span className="font-semibold">{data.confirmed_count}</span> order{data.confirmed_count === 1 ? '' : 's'} approved
        </div>
        <div>
          <span className="font-semibold">{totalQty}</span> units in total
        </div>
        {data.skipped.length > 0 && (
          <div className="text-[var(--warning)]">
            <span className="font-semibold">{data.skipped.length}</span> not approved
          </div>
        )}
        <div className="ml-auto">
          <EmailNotice email={data.email} />
        </div>
      </Card>

      {data.orders.length < data.confirmed_count && (
        <p className="text-xs text-[var(--muted-foreground)]">
          Showing the {data.orders.length} of {data.confirmed_count} approved orders you have access to.
        </p>
      )}

      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] text-left text-xs text-[var(--muted-foreground)]">
              <th className="px-4 py-2 font-medium">Order</th>
              <th className="px-2 py-2 font-medium">Store</th>
              <th className="px-2 py-2 text-right font-medium">Lines</th>
              <th className="px-2 py-2 text-right font-medium">Qty</th>
              <th className="px-4 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {data.orders.map((o) => (
              <tr key={o.id} className="border-b border-[var(--border)] last:border-0">
                <td className="px-4 py-2">
                  <Link to={`/orders/${o.id}`} className="font-medium text-[var(--accent)] hover:underline">
                    {o.reference || o.id.slice(0, 8)}
                  </Link>
                </td>
                <td className="px-2 py-2">{[o.store_number, o.store_name].filter(Boolean).join(' - ') || '—'}</td>
                <td className="px-2 py-2 text-right">{o.line_count}</td>
                <td className="px-2 py-2 text-right">{o.total_quantity}</td>
                <td className="px-4 py-2">
                  <OrderStatusBadge status={o.status as OrderStatus} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {data.skipped.length > 0 && (
        <Card className="p-4 text-sm">
          <div className="mb-1 font-medium">Selected but not approved</div>
          <ul className="list-disc pl-5 text-xs text-[var(--muted-foreground)]">
            {data.skipped.map((s) => (
              <li key={s.id}>
                <span className="font-mono">{s.id.slice(0, 8)}</span> — {s.reason}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
