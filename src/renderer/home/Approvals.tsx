// A job run that wanted to send, spend, or change something asks here, in
// its own conversation, just above the composer. Nothing happens until the
// user decides; the result lands in this thread.

import type { ReactElement } from 'react';
import type { JobApproval } from '../../shared/jobs';
import { buddy } from '../buddy';
import { withoutEmDash } from '../shared/markdown';
import { useJobsView } from '../shared/jobs-data';
import { Button, Card, LinkButton } from '../ui';

const DETAIL_MAX = 220;

export function Approvals({ conversationId }: { conversationId: string | null }): ReactElement | null {
  const approvals = useJobsView()?.approvals.filter((approval) => approval.conversationId === conversationId) ?? [];
  if (approvals.length === 0) return null;
  return (
    <div className="mb-2 flex flex-col gap-2">
      {approvals.map((approval) => (
        <ApprovalCard key={approval.id} approval={approval} />
      ))}
    </div>
  );
}

function ApprovalCard({ approval }: { approval: JobApproval }): ReactElement {
  const decide = (decision: 'once' | 'always' | 'deny'): void => {
    void buddy.resolveApproval(approval.id, decision);
  };
  const detail = withoutEmDash(approval.detail);
  return (
    <Card className="gap-1">
      <span className="text-[13px] font-medium">{withoutEmDash(approval.title)}</span>
      {detail ? (
        <span className="text-[12px] leading-5 text-muted">
          {detail.length > DETAIL_MAX ? `${detail.slice(0, DETAIL_MAX - 1)}…` : detail}
        </span>
      ) : null}
      <div className="mt-2 flex items-center gap-4">
        <LinkButton tone="danger" onClick={() => decide('deny')}>
          Deny
        </LinkButton>
        {approval.always ? <LinkButton onClick={() => decide('always')}>Always allow</LinkButton> : null}
        <Button className="ml-auto" onClick={() => decide('once')}>
          Allow once
        </Button>
      </div>
    </Card>
  );
}
