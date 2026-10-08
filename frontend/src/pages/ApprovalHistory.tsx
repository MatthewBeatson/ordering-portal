import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { approvalBatchesApi } from '@/lib/api';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';

export default function ApprovalHistory() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['approval-batches'],
    queryFn: () => approvalBatchesApi.list(),
  });

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <div>
        <Link to="/approvals" className="text-sm text-[var(--accent)] hover:underline">
          Back to approvals
        </Link>
        <h1 className="mt-1 text-lg font-semibold">Approval history</h1>
        <p className="text-sm text-[var(--muted-foreground)]">Each time several orders are approved together, it's saved here as one group.</p>
      </div>

      {isLoading && (
        <div className="flex h-32 items-center justify-center">
          <Spinner className="h-6 w-6" />
        </div>
      )}

      {error && <Card className="p-6 text-sm text-[var(--danger)]">Couldn't load approval history: {(error as Error).message}</Card>}

      {data && data.batches.length === 0 && (
        <Card className="p-6 text-sm text-[var(--muted-foreground)]">No bulk approvals yet. They'll appear here after you approve several orders at once.</Card>
      )}

      {data && data.batches.length > 0 && (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-left text-xs text-[var(--muted-foreground)]">
                <th className="px-4 py-2 font-medium">Approved</th>
                <th className="px-2 py-2 font-medium">By</th>
                <th className="px-2 py-2 text-right font-medium">Orders</th>
                <th className="px-4 py-2 font-medium">Email</th>
              </tr>
            </thead>
            <tbody>
              {data.batches.map((b) => (
                <tr key={b.id} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--muted)]/50">
                  <td className="px-4 py-2">
                    <Link to={`/approvals/batches/${b.id}`} className="font-medium text-[var(--accent)] hover:underline">
                      {b.time} on {b.date}
                    </Link>
                  </td>
                  <td className="px-2 py-2">{b.approved_by?.full_name || b.approved_by?.email || '—'}</td>
                  <td className="px-2 py-2 text-right">
                    {b.confirmed_count}
                    {b.skipped_count > 0 && <span className="text-xs text-[var(--muted-foreground)]"> (+{b.skipped_count} skipped)</span>}
                  </td>
                  <td className="px-4 py-2">
                    {b.email_status === 'sent' ? (
                      <Badge tone="success">Sent</Badge>
                    ) : b.email_status === 'failed' ? (
                      <Badge tone="danger">Failed</Badge>
                    ) : (
                      <Badge tone="muted">Not sent</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
