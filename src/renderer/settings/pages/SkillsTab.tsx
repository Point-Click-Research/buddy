import { useState, type ReactElement } from 'react';
import type { WritingSkill } from '../../../shared/types';
import { Actions, Button, LinkButton, Modal, Note, SectionHeader, Table, TableRow, Textarea } from '../../ui';
import { useSettings } from '../context';

const FILE_TYPES = '.md,.markdown,.txt';

function chooseFiles(multiple: boolean, onFiles: (files: File[]) => void): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = FILE_TYPES;
  input.multiple = multiple;
  input.addEventListener('change', () => {
    const files = [...(input.files ?? [])];
    if (files.length > 0) onFiles(files);
  });
  input.click();
}

const PLACEHOLDER = `---
name: my-skill
---

# My Skill

Detailed instructions for the agent.

## When to Use

- Use this skill when...

## Instructions

- Step-by-step guidance for the agent`;

function skillToMd(skill: WritingSkill): string {
  return `---\nname: ${skill.name}\n---\n\n${skill.instructions}\n`;
}

function downloadSkill(skill: WritingSkill): void {
  const blob = new Blob([skillToMd(skill)], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${skill.name.replace(/[^\w-]+/g, '-')}.md`;
  link.click();
  URL.revokeObjectURL(url);
}

function uniqueSkillName(base: string, taken: readonly string[]): string {
  const used = new Set(taken.map((entry) => entry.toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  for (let i = 2; i < 100; i++) {
    const next = `${base}-${i}`;
    if (!used.has(next.toLowerCase())) return next;
  }
  return `${base}-${Date.now()}`;
}

function mdToSkill(text: string): WritingSkill | null {
  let name = '';
  let body = text;
  const frontmatter = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (frontmatter) {
    body = text.slice(frontmatter[0].length);
    name = frontmatter[1].match(/^name:\s*(.+)$/m)?.[1].trim() ?? '';
  }
  name ||= body.match(/^#\s+(.+)$/m)?.[1].trim() ?? '';
  const instructions = body.trim();
  return name && instructions ? { name, instructions } : null;
}

export function SkillsPage(): ReactElement {
  const { view, patch } = useSettings();
  const skills = view.settings.skills;
  // null is closed; 'new' is a blank skill. A number is the list index.
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const close = (): void => {
    setEditing(null);
    setError('');
  };

  const openEditor = (target: number | 'new'): void => {
    setEditing(target);
    setDraft(target === 'new' ? '' : skillToMd(skills[target]));
    setError('');
    setNotice('');
  };

  const saveSkills = async (next: WritingSkill[]): Promise<void> => {
    await patch({ skills: next });
  };

  const current = typeof editing === 'number' ? skills[editing] : undefined;

  const saveDraft = async (): Promise<void> => {
    const parsed = mdToSkill(draft);
    if (!parsed) {
      setError('The skill needs a name (frontmatter "name:" or a "# Heading") and instructions.');
      return;
    }
    if (editing === 'new') {
      await saveSkills([
        ...skills,
        { ...parsed, name: uniqueSkillName(parsed.name, skills.map((skill) => skill.name)) },
      ]);
    } else if (current && typeof editing === 'number') {
      // Edits keep the flags; a built-in also keeps its name; the
      // name is how the model, and the no-delete rule, find it.
      const next = [...skills];
      next[editing] = {
        ...current,
        instructions: parsed.instructions,
        ...(current.builtIn ? {} : { name: parsed.name }),
      };
      await saveSkills(next);
    }
    close();
  };

  const importFiles = (): void => {
    chooseFiles(true, async (files) => {
      const builtIn = new Set(skills.filter((skill) => skill.builtIn).map((skill) => skill.name.toLowerCase()));
      const next = [...skills];
      const skipped: string[] = [];
      for (const file of files) {
        const parsed = mdToSkill(await file.text());
        if (!parsed) {
          skipped.push(file.name);
          continue;
        }
        if (builtIn.has(parsed.name.toLowerCase())) {
          skipped.push(`${parsed.name} (built-in)`);
          continue;
        }
        next.push({ ...parsed, name: uniqueSkillName(parsed.name, next.map((skill) => skill.name)) });
      }
      await saveSkills(next);
      setNotice(skipped.length ? `Skipped: ${skipped.join(', ')}.` : '');
      close();
    });
  };

  return (
    <>
      <SectionHeader
        title="Skills"
        description="Named instructions Buddy can run. Auto skills load when their app or site is front. Built-ins can be edited or disabled, not deleted."
      />
      <Table
        columns={[{ key: '#', label: '#' }, { key: 'main', label: 'Skill' }, { key: 'action', label: '' }]}
        empty="No skills yet"
      >
        {skills.map((skill, index) => (
          <TableRow
            key={`${skill.name}-${index}`}
            index={index + 1}
            main={
              <>
                {skill.name}
                {skill.builtIn && <span className="text-faint"> · built-in</span>}
                {(skill.apps?.length || skill.sites?.length) ? (
                  <span className="text-faint"> · auto</span>
                ) : null}
                {skill.disabled && <span className="text-faint"> · disabled</span>}
              </>
            }
            action={
              <>
                {skill.builtIn && (
                  <LinkButton
                    onClick={() => {
                      void saveSkills(
                        skills.map((entry, i) =>
                          i === index ? { ...entry, disabled: !entry.disabled } : entry,
                        ),
                      );
                    }}
                  >
                    {skill.disabled ? 'Enable' : 'Disable'}
                  </LinkButton>
                )}
                <LinkButton onClick={() => openEditor(index)}>Edit</LinkButton>
                <LinkButton onClick={() => downloadSkill(skill)}>Export</LinkButton>
              </>
            }
          />
        ))}
      </Table>

      <Actions align="start">
        <Button onClick={() => openEditor('new')}>Add Skill</Button>
        <Button variant="secondary" onClick={importFiles}>
          Import .md
        </Button>
      </Actions>
      <Note tone="fail">{notice}</Note>

      {editing !== null && (
        <Modal title={current ? `Edit ${current.name || 'Skill'}` : 'Add Skill'} onClose={close}>
          <form
            className="flex flex-col gap-3.5"
            onSubmit={(event) => {
              event.preventDefault();
              void saveDraft();
            }}
          >
            <p className="text-[13px] leading-5 text-muted">Markdown skill file. Or upload .md.</p>
            <Textarea
              className="min-h-60"
              mono
              rows={14}
              placeholder={PLACEHOLDER}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
            {current?.builtIn && (
              <Note>Built-in: edit freely. Name is fixed; disable instead of delete.</Note>
            )}
            <Actions>
              {current && !current.builtIn && (
                <LinkButton
                  tone="danger"
                  className="mr-auto"
                  onClick={() => {
                    void saveSkills(skills.filter((_, i) => i !== editing)).then(close);
                  }}
                >
                  Delete
                </LinkButton>
              )}
              <Button type="submit">{current ? 'Save Skill' : 'Add Skill'}</Button>
              <Button variant="secondary" onClick={close}>
                Cancel
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  chooseFiles(false, async (files) => {
                    const file = files[0];
                    if (!file) return;
                    setDraft(await file.text());
                    setError('');
                  });
                }}
              >
                Upload .md
              </Button>
            </Actions>
            <Note tone="fail">{error}</Note>
          </form>
        </Modal>
      )}
    </>
  );
}
