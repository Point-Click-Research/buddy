// Settings → Jobs: the saved jobs with their schedules and how the last run
// went, and the form that creates or edits one (from a template or from
// scratch). Jobs are also made by voice: create_job takes "make a job
// that…" from any ask. A run's writes that wait for an OK are answered in
// that job's conversation, not here. Suggestions have their own page.

import { PenLine } from 'lucide-react';
import { useState, useSyncExternalStore, type ReactElement } from 'react';
import { chordLabel } from '../../../shared/hotkeys';
import {
  JOB_TEMPLATES,
  jobNeeds,
  scheduleLabel,
  templateChecks,
  type Job,
  type JobDraft,
} from '../../../shared/jobs';
import { withoutEmDash } from '../../shared/markdown';
import { useJobsView } from '../../shared/jobs-data';
import { getTalkState, subscribeTalk } from '../../shared/talk';
import { USE_CASE_ICONS } from '../../shared/use-case-icons';
import { buddy } from '../../buddy';
import { Actions, Button, LinkButton, MenuSelect, Modal, SectionHeader, Table, TableRow, TextInput } from '../../ui';
import { InstructionsField } from '../jobs/InstructionsField';
import { ScheduleFields } from '../jobs/ScheduleFields';
import { ReadinessRow, useSnap } from '../jobs/readiness';

const BLANK: JobDraft = { name: '', prompt: '', schedule: 'daily-9' };
const FORM_ID = 'job-form';

const JOB_COLUMNS = [
  { key: '#', label: '#' },
  { key: 'main', label: 'Job' },
  { key: 'action', label: '' },
];

const NEED_COLUMNS = [
  { key: '#', label: '#' },
  { key: 'main', label: 'Need' },
  { key: 'action', label: '' },
];

export function JobsPage(): ReactElement {
  const view = useJobsView();
  const [draft, setDraft] = useState<JobDraft | null>(null);
  const [templateId, setTemplateId] = useState('');
  const { chord } = useSyncExternalStore(subscribeTalk, getTalkState);
  const jobs = view?.jobs ?? [];

  const pickTemplate = (id: string): void => {
    setTemplateId(id);
    const template = JOB_TEMPLATES.find((entry) => entry.id === id);
    setDraft(
      template
        ? { name: template.label, prompt: template.prompt, schedule: template.schedule }
        : BLANK,
    );
  };

  const save = (): void => {
    if (!draft?.prompt.trim()) return;
    void buddy.saveJob(draft);
    closeForm();
  };

  const edit = (job: Job): void => {
    setTemplateId('');
    setDraft({ id: job.id, name: job.name, prompt: job.prompt, schedule: job.schedule });
  };

  const closeForm = (): void => {
    setDraft(null);
    setTemplateId('');
  };

  return (
    <>
      <SectionHeader
        title="Scheduled jobs"
        description="Buddy runs these on a schedule, or when you say “run” and the job's name."
      />
      <Table columns={JOB_COLUMNS} empty="No jobs yet.">
        {jobs.map((job, index) => (
          <JobRow key={job.id} job={job} index={index + 1} onEdit={() => edit(job)} />
        ))}
      </Table>
      <Actions align="start">
        <Button
          onClick={() => {
            setTemplateId('');
            setDraft(BLANK);
          }}
        >
          New job
        </Button>
        <span className="text-[12px] text-faint">
          {chord ? `or hold ${chordLabel(chord)} and say “make a job that…”` : 'or ask Buddy to “make a job that…”'}
        </span>
      </Actions>
      {draft ? (
        <Modal
          title={draft.id ? `Edit ${draft.name || 'job'}` : 'New job'}
          onClose={closeForm}
          footer={
            <>
              {draft.id ? <EditActions id={draft.id} onClose={closeForm} /> : null}
              <Button variant="secondary" onClick={closeForm}>
                Cancel
              </Button>
              <Button type="submit" form={FORM_ID} disabled={!draft.prompt.trim()}>
                Save
              </Button>
            </>
          }
        >
          <JobForm draft={draft} templateId={templateId} onDraft={setDraft} onTemplate={pickTemplate} onSave={save} />
        </Modal>
      ) : null}
    </>
  );
}

/**
 * One job: its name (which opens its conversation in the chat window) and a
 * status word when there is one worth seeing, over one quiet line: when it
 * runs, when it last did. The reports live in that conversation.
 */
function JobRow({ job, index, onEdit }: { job: Job; index: number; onEdit: () => void }): ReactElement {
  const failed = job.lastReport.startsWith('Failed');
  const status = job.running
    ? { label: 'Running', tone: 'text-ok' }
    : job.paused
      ? { label: 'Paused', tone: 'text-faint' }
      : failed
        ? { label: 'Last run failed', tone: 'text-danger' }
        : null;
  const name = withoutEmDash(job.name);
  return (
    <TableRow
      index={index}
      main={
        <span className="flex min-w-0 items-center gap-2">
          {job.conversationId ? (
            <button
              type="button"
              title="Open its reports"
              onClick={() => buddy.openHome({ conversationId: job.conversationId })}
              className="min-w-0 cursor-pointer truncate border-0 bg-transparent p-0 text-left font-medium text-ink hover:underline"
            >
              {name}
            </button>
          ) : (
            <span className="min-w-0 truncate">{name}</span>
          )}
          {status ? (
            <span className={`shrink-0 text-[11px] font-medium ${status.tone}`} title={failed ? job.lastReport : undefined}>
              {status.label}
            </span>
          ) : null}
        </span>
      }
      detail={<span className="block truncate">{`${scheduleLabel(job.schedule)} · ${lastRunLine(job)}`}</span>}
      action={
        <>
          <LinkButton onClick={onEdit}>Edit</LinkButton>
          <Button variant="secondary" disabled={job.running} onClick={() => void buddy.runJobNow(job.id)}>
            Run now
          </Button>
        </>
      }
    />
  );
}

function lastRunLine(job: Job): string {
  if (!job.lastRunAt) return 'Not run yet';
  const at = new Date(job.lastRunAt);
  const today = at.toDateString() === new Date().toDateString();
  return `Ran ${today
    ? at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : at.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    }`;
}

function JobForm({
  draft,
  templateId,
  onDraft,
  onTemplate,
  onSave,
}: {
  draft: JobDraft;
  templateId: string;
  onDraft: (next: JobDraft) => void;
  onTemplate: (id: string) => void;
  onSave: () => void;
}): ReactElement {
  const { snap, pendingServers, pendingApps, pendingSignins } = useSnap();
  const template = JOB_TEMPLATES.find((entry) => entry.id === templateId);
  const checks = templateChecks(jobNeeds(draft.prompt, template?.needs), snap);
  return (
    <form
      id={FORM_ID}
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      {!draft.id ? (
        <MenuSelect
          label="Start from"
          value={templateId}
          options={[
            {
              value: '',
              label: 'Blank',
              description: 'Write it yourself.',
              icon: <PenLine className="size-4" strokeWidth={1.6} aria-hidden />,
            },
            ...JOB_TEMPLATES.map((entry) => {
              const Icon = USE_CASE_ICONS[entry.kind];
              return {
                value: entry.id,
                label: entry.label,
                description: entry.blurb,
                icon: <Icon className="size-4" strokeWidth={1.6} aria-hidden />,
              };
            }),
          ]}
          onSelect={onTemplate}
        />
      ) : null}
      <TextInput
        label="Name"
        value={draft.name}
        placeholder="Paper towels"
        onChange={(event) => onDraft({ ...draft, name: event.target.value })}
      />
      <InstructionsField
        label="What to do"
        value={draft.prompt}
        placeholder="Reorder two packs of paper towels from…"
        onChange={(prompt) => onDraft({ ...draft, prompt })}
      />
      <ScheduleFields value={draft.schedule} onChange={(schedule) => onDraft({ ...draft, schedule })} />
      {checks.length > 0 ? (
        <div className="flex flex-col gap-2">
          <span className="text-[13px] font-medium">This job needs</span>
          <Table columns={NEED_COLUMNS}>
            {checks.map((item, index) => (
              <ReadinessRow
                key={item.label}
                item={item}
                index={index + 1}
                pending={
                  (item.await === 'servers' && pendingServers) ||
                  (item.await === 'apps' && pendingApps) ||
                  (item.await === 'signins' && pendingSignins)
                }
              />
            ))}
          </Table>
        </div>
      ) : null}
    </form>
  );
}

/** Delete (sent left) and Pause/Resume, only while editing an existing job. */
function EditActions({ id, onClose }: { id: string; onClose: () => void }): ReactElement {
  const view = useJobsView();
  const job = view?.jobs.find((entry) => entry.id === id);
  return (
    <>
      <LinkButton
        tone="danger"
        className="mr-auto"
        onClick={() => {
          void buddy.deleteJob(id);
          onClose();
        }}
      >
        Delete
      </LinkButton>
      {job ? (
        <Button variant="secondary" onClick={() => void buddy.setJobPaused(id, !job.paused)}>
          {job.paused ? 'Resume' : 'Pause'}
        </Button>
      ) : null}
    </>
  );
}
