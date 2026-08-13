import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { staffApi, type StaffMember } from '@/lib/api';
import { useAuth } from '@/lib/AuthContext';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';

// Super-admin-only: grant/revoke is_portal_admin and is_super_admin on
// anyone who already has a `users` row (i.e. anyone who's ever been
// given portal access -- buyer, store_admin, client_admin, or staff).
// Deliberately not a "search all Supabase accounts" screen -- see
// backend/src/services/staff.js for why.
export default function Staff() {
  const { session } = useAuth();
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['staff'],
    queryFn: () => staffApi.list(),
  });

  const update = useMutation({
    mutationFn: ({ id, input }: { id: string; input: { is_portal_admin?: boolean; is_super_admin?: boolean } }) =>
      staffApi.update(id, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['staff'] }),
  });

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  if (error) {
    return <Card className="p-6 text-sm text-[var(--danger)]">Couldn't load staff: {(error as Error).message}</Card>;
  }

  const staff = data?.staff ?? [];
  const currentUserId = session?.user.id;

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">Staff</h1>
        <p className="text-sm text-[var(--muted-foreground)]">
          Grant or revoke Shonrei admin and super-admin access. Only people who already have some portal access show up
          here -- onboarding someone brand new still needs the usual setup step first.
        </p>
      </div>

      {update.isError && <p className="text-sm text-[var(--danger)]">{(update.error as Error).message}</p>}

      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] text-left text-xs text-[var(--muted-foreground)]">
              <th className="px-4 py-2 font-medium">User</th>
              <th className="px-2 py-2 font-medium">Role</th>
              <th className="w-56 px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {staff.map((member) => (
              <StaffRow
                key={member.id}
                member={member}
                isSelf={member.id === currentUserId}
                onUpdate={(input) => update.mutate({ id: member.id, input })}
                pending={update.isPending && update.variables?.id === member.id}
              />
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function StaffRow({
  member,
  isSelf,
  onUpdate,
  pending,
}: {
  member: StaffMember;
  isSelf: boolean;
  onUpdate: (input: { is_portal_admin?: boolean; is_super_admin?: boolean }) => void;
  pending: boolean;
}) {
  return (
    <tr className="border-b border-[var(--border)] last:border-0">
      <td className="px-4 py-2">
        <div className="font-medium">{member.full_name || member.email}</div>
        {member.full_name && <div className="text-xs text-[var(--muted-foreground)]">{member.email}</div>}
        {isSelf && <div className="text-xs text-[var(--muted-foreground)]">(you)</div>}
      </td>
      <td className="px-2 py-2">
        {member.is_super_admin ? (
          <Badge tone="purple">Super admin</Badge>
        ) : member.is_portal_admin ? (
          <Badge tone="accent">Admin</Badge>
        ) : (
          <Badge tone="muted">No staff access</Badge>
        )}
      </td>
      <td className="px-4 py-2 text-right">
        <div className="flex justify-end gap-2">
          {member.is_super_admin ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={pending || isSelf}
              title={isSelf ? "You can't remove your own super-admin access" : undefined}
              onClick={() => onUpdate({ is_super_admin: false })}
            >
              Revoke super admin
            </Button>
          ) : (
            <Button size="sm" variant="secondary" disabled={pending} onClick={() => onUpdate({ is_super_admin: true })}>
              Make super admin
            </Button>
          )}

          {member.is_portal_admin && !member.is_super_admin && (
            <Button
              size="sm"
              variant="secondary"
              disabled={pending || isSelf}
              title={isSelf ? "You can't remove your own admin access" : undefined}
              onClick={() => onUpdate({ is_portal_admin: false })}
            >
              Revoke admin
            </Button>
          )}
          {!member.is_portal_admin && (
            <Button size="sm" variant="secondary" disabled={pending} onClick={() => onUpdate({ is_portal_admin: true })}>
              Make admin
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
}
