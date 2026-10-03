import {
  type Account,
  type MailLanguage,
  type PatchAccountInput,
  type Settings,
  settingsInput,
} from '@shared/schemas.ts';
import { useForm } from '@tanstack/react-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { Check, CircleAlert, Copy, Mail, Plus, X } from 'lucide-react';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { toast } from 'sonner';
import { FieldError } from '@/components/field-error.tsx';
import { INTERVAL_FIELD_ID, SyncStatus } from '@/components/sync-status.tsx';
import { Alert, AlertDescription } from '@/components/ui/alert.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Label } from '@/components/ui/label.tsx';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group.tsx';
import { useT } from '@/i18n/i18n.tsx';
import { ApiClientError, api, queryKeys, unwrap } from '@/lib/api.ts';
import { meQuery } from '@/lib/auth.ts';
import {
  accountQuery,
  errorCode,
  patchAccount,
  settingsQuery,
} from '@/lib/queries.ts';
import { normalizeRecipient, recipientProblem } from '@/lib/recipients.ts';
import { cn } from '@/lib/utils.ts';

export const Route = createFileRoute('/_app/settings')({
  component: SettingsPage,
});

interface Values {
  syncIntervalHours: string;
  segmentRetentionDays: string;
  email: string;
  recipients: string[];
  mailLanguage: MailLanguage;
}

const LANGS = [
  ['de', 'settings.langDe'],
  ['en', 'settings.langEn'],
] as const;

function SettingsPage() {
  const t = useT();
  const me = useQuery(meQuery);
  const isAdmin = me.data?.role === 'admin';
  const account = useQuery(accountQuery);
  // Admin-only endpoints answer 403 for users: never ask them.
  const settings = useQuery({ ...settingsQuery, enabled: isAdmin });
  const rawFailed = me.isError
    ? me.error
    : account.isError
      ? account.error
      : isAdmin && settings.isError
        ? settings.error
        : null;
  // A 403 usually means the role changed: refetch `me` once before failing.
  const forbidden =
    rawFailed instanceof ApiClientError && rawFailed.code === 'forbidden';
  const [recheck, setRecheck] = useState<'idle' | 'running' | 'done'>('idle');
  const refetchMe = me.refetch;
  useEffect(() => {
    if (!forbidden || recheck !== 'idle') return;
    setRecheck('running');
    void refetchMe().finally(() => setRecheck('done'));
  }, [forbidden, recheck, refetchMe]);
  const failed = forbidden && recheck !== 'done' ? null : rawFailed;
  const ready =
    me.data !== undefined &&
    account.data !== undefined &&
    (!isAdmin || settings.data !== undefined);
  return (
    <div className="space-y-6 pb-20 md:pb-4">
      <header className="space-y-2">
        <p className="kicker">{t('settings.kicker')}</p>
        <h1 className="page-title">{t('settings.title')}</h1>
      </header>
      {failed ? (
        <Alert variant="destructive">
          <CircleAlert aria-hidden />
          <AlertDescription>{t.error(errorCode(failed))}</AlertDescription>
        </Alert>
      ) : !ready ? (
        <p className="text-muted-foreground">{t('app.loading')}</p>
      ) : (
        <SettingsForm
          account={account.data}
          settings={isAdmin ? (settings.data ?? null) : null}
        />
      )}
    </div>
  );
}

function toValues(a: Account, s: Settings | null): Values {
  return {
    syncIntervalHours: String(s?.syncIntervalHours ?? ''),
    segmentRetentionDays: String(s?.segmentRetentionDays ?? ''),
    email: a.email,
    recipients: a.recipients,
    mailLanguage: a.mailLanguage,
  };
}

function settingsDirty(a: Values, b: Values): boolean {
  return (
    a.syncIntervalHours.trim() !== b.syncIntervalHours.trim() ||
    a.segmentRetentionDays.trim() !== b.segmentRetentionDays.trim()
  );
}

function accountPatch(a: Values, b: Values): PatchAccountInput | null {
  const patch: PatchAccountInput = {};
  if (a.email.trim() !== b.email.trim()) patch.email = a.email.trim();
  if (a.recipients.join('\n') !== b.recipients.join('\n'))
    patch.recipients = a.recipients;
  if (a.mailLanguage !== b.mailLanguage) patch.mailLanguage = a.mailLanguage;
  return Object.keys(patch).length > 0 ? patch : null;
}

function Section({
  title,
  hint,
  children,
  muted,
}: {
  title: string;
  hint: string;
  children: ReactNode;
  muted?: boolean;
}) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className={cn(
        'grid gap-5 p-5 grid-cols-[minmax(0,1fr)] md:grid-cols-[13rem_minmax(0,1fr)] md:gap-8 md:p-6',
        muted ? 'rounded-md border border-dashed' : 'surface',
      )}
    >
      <div className="space-y-1">
        <h2
          id={id}
          className="font-display text-xl leading-none font-extrabold tracking-wide uppercase"
        >
          {title}
        </h2>
        <p className="text-sm text-muted-foreground">{hint}</p>
      </div>
      <div className="grid gap-6 grid-cols-[minmax(0,1fr)]">{children}</div>
    </section>
  );
}

function SettingsForm({
  account,
  settings,
}: {
  account: Account;
  settings: Settings | null;
}) {
  const t = useT();
  const qc = useQueryClient();
  const uid = useId();
  const formId = `${uid}-form`;
  const [baseline, setBaseline] = useState<Values>(() =>
    toValues(account, settings),
  );
  const [draftKey, setDraftKey] = useState(0);
  const [hasDraft, setHasDraft] = useState(false);

  const save = useMutation({
    mutationFn: async (v: Values) => {
      // Each endpoint is called only when its own part changed; a failure in
      // one still keeps the other saved part (baseline moves per part).
      const next = { ...baseline };
      const kept = { ...v };
      let error: unknown = null;
      if (settings && settingsDirty(v, baseline)) {
        try {
          const saved = await unwrap(
            api.api.settings.$put({
              json: {
                syncIntervalHours: Number(v.syncIntervalHours),
                segmentRetentionDays: Number(v.segmentRetentionDays),
              },
            }),
          );
          qc.setQueryData(queryKeys.settings, saved);
          next.syncIntervalHours = String(saved.syncIntervalHours);
          next.segmentRetentionDays = String(saved.segmentRetentionDays);
          kept.syncIntervalHours = next.syncIntervalHours;
          kept.segmentRetentionDays = next.segmentRetentionDays;
          void qc.invalidateQueries({ queryKey: queryKeys.streamers });
        } catch (err) {
          error = err;
        }
      }
      const patch = accountPatch(v, baseline);
      if (patch) {
        try {
          const saved = await patchAccount(patch);
          qc.setQueryData(queryKeys.account, saved);
          next.email = saved.email;
          next.recipients = saved.recipients;
          next.mailLanguage = saved.mailLanguage;
          kept.email = next.email;
          kept.recipients = next.recipients;
          kept.mailLanguage = next.mailLanguage;
        } catch (err) {
          error ??= err;
        }
      }
      void qc.invalidateQueries({ queryKey: queryKeys.overview });
      setBaseline(next);
      // Saved parts show the server value; a failed part keeps its input.
      form.reset(kept);
      if (error !== null) throw error;
    },
    onSuccess: () => toast.success(t('settings.saved')),
    onError: (err) => toast.error(t.error(errorCode(err))),
  });

  const form = useForm({
    defaultValues: baseline,
    onSubmit: async ({ value }) => {
      await save.mutateAsync(value).catch(() => {});
    },
  });

  return (
    <div className="space-y-6">
      <form
        id={formId}
        noValidate
        className="grid gap-6 grid-cols-[minmax(0,1fr)]"
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
      >
        <Section
          title={t('settings.sectionAccount')}
          hint={t('settings.sectionAccountHint')}
        >
          <div className="grid gap-1.5">
            <Label htmlFor={`${uid}-username`}>
              {t('settings.accountUsername')}
            </Label>
            <Input
              id={`${uid}-username`}
              value={account.username}
              readOnly
              className="max-w-xs"
            />
          </div>

          <form.Field
            name="email"
            validators={{
              onChange: ({ value }) =>
                recipientProblem(value, []) === 'invalid'
                  ? t('settings.recipientInvalid')
                  : undefined,
            }}
          >
            {(field) => (
              <div className="grid gap-1.5">
                <Label htmlFor={`${uid}-email`}>
                  {t('settings.accountEmail')}
                </Label>
                <Input
                  id={`${uid}-email`}
                  type="email"
                  autoComplete="email"
                  className="max-w-md"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                  aria-invalid={field.state.meta.errors.length > 0 || undefined}
                />
                <FieldError errors={field.state.meta.errors} />
              </div>
            )}
          </form.Field>

          <form.Field
            name="recipients"
            validators={{
              onChange: ({ value }) =>
                value.length === 0
                  ? t('settings.recipientsRequired')
                  : undefined,
            }}
          >
            {(field) => (
              <RecipientsField
                key={draftKey}
                onDraftChange={setHasDraft}
                value={field.state.value}
                onChange={field.handleChange}
                errors={field.state.meta.errors}
              />
            )}
          </form.Field>

          <form.Field name="mailLanguage">
            {(field) => (
              <fieldset className="grid min-w-0 gap-2">
                <legend className="mb-2 text-sm font-medium">
                  {t('settings.mailLanguage')}
                </legend>
                <RadioGroup
                  value={field.state.value}
                  onValueChange={(v) => field.handleChange(v as MailLanguage)}
                  className="flex flex-wrap gap-5"
                >
                  {LANGS.map(([v, key]) => (
                    <Label
                      key={v}
                      className="flex items-center gap-2 font-normal"
                    >
                      <RadioGroupItem value={v} />
                      {t(key)}
                    </Label>
                  ))}
                </RadioGroup>
              </fieldset>
            )}
          </form.Field>

          <Link
            to="/change-password"
            className="w-fit text-sm font-medium underline underline-offset-4"
          >
            {t('settings.changePasswordLink')}
          </Link>
        </Section>

        {settings && (
          <>
            <Section
              title={t('settings.sectionSync')}
              hint={t('settings.sectionSyncHint')}
            >
              <form.Field
                name="syncIntervalHours"
                validators={{
                  onChange: ({ value }) =>
                    settingsInput.shape.syncIntervalHours.safeParse(
                      value.trim() === '' ? Number.NaN : Number(value),
                    ).success
                      ? undefined
                      : t('settings.intervalInvalid'),
                }}
              >
                {(field) => (
                  <div className="grid gap-1.5">
                    <Label htmlFor={INTERVAL_FIELD_ID}>
                      {t('settings.interval')}
                    </Label>
                    <p
                      id={`${uid}-interval-hint`}
                      className="text-sm text-muted-foreground"
                    >
                      {t('settings.intervalHint')}
                    </p>
                    <div className="flex items-center gap-2">
                      <Input
                        id={INTERVAL_FIELD_ID}
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={168}
                        step={1}
                        className="tabular w-24"
                        value={field.state.value}
                        onChange={(e) => field.handleChange(e.target.value)}
                        onBlur={field.handleBlur}
                        aria-invalid={
                          field.state.meta.errors.length > 0 || undefined
                        }
                        aria-describedby={`${uid}-interval-hint`}
                      />
                      <span className="text-sm">
                        {t('settings.intervalUnit')}
                      </span>
                    </div>
                    <FieldError errors={field.state.meta.errors} />
                  </div>
                )}
              </form.Field>
            </Section>

            <Section
              title={t('settings.sectionTimeline')}
              hint={t('settings.sectionTimelineHint')}
            >
              <form.Field
                name="segmentRetentionDays"
                validators={{
                  onChange: ({ value }) =>
                    settingsInput.shape.segmentRetentionDays.safeParse(
                      value.trim() === '' ? Number.NaN : Number(value),
                    ).success
                      ? undefined
                      : t('settings.retentionInvalid'),
                }}
              >
                {(field) => (
                  <div className="grid gap-1.5">
                    <Label htmlFor={`${uid}-retention`}>
                      {t('settings.retention')}
                    </Label>
                    <p
                      id={`${uid}-retention-hint`}
                      className="text-sm text-muted-foreground"
                    >
                      {t('settings.retentionHint')}
                    </p>
                    <div className="flex items-center gap-2">
                      <Input
                        id={`${uid}-retention`}
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={3650}
                        step={1}
                        className="tabular w-24"
                        value={field.state.value}
                        onChange={(e) => field.handleChange(e.target.value)}
                        onBlur={field.handleBlur}
                        aria-invalid={
                          field.state.meta.errors.length > 0 || undefined
                        }
                        aria-describedby={`${uid}-retention-hint`}
                      />
                      <span className="text-sm">
                        {t('settings.retentionUnit')}
                      </span>
                    </div>
                    <FieldError errors={field.state.meta.errors} />
                  </div>
                )}
              </form.Field>
            </Section>
          </>
        )}
      </form>

      <Section
        muted
        title={t('settings.sectionDiagnostics')}
        hint={t('settings.sectionDiagnosticsHint')}
      >
        <TestMail recipientCount={account.recipients.length} />
        {settings && (
          <div className="grid gap-1.5">
            <p id={`${uid}-callback-label`} className="text-sm font-medium">
              {t('settings.callbackUrl')}
            </p>
            <p
              id={`${uid}-callback-hint`}
              className="text-sm text-muted-foreground"
            >
              {t('settings.callbackUrlHint')}
            </p>
            <div className="flex flex-wrap items-start gap-2">
              <code
                id={`${uid}-callback`}
                className="tabular min-w-0 flex-1 basis-56 rounded-md border bg-paper px-3 py-2 font-mono text-sm break-all"
              >
                {settings.callbackUrl}
              </code>
              <CopyButton
                value={settings.callbackUrl}
                targetId={`${uid}-callback`}
                describedBy={`${uid}-callback-label ${uid}-callback`}
              />
            </div>
          </div>
        )}
      </Section>

      {settings && <SyncStatus intervalHours={settings.syncIntervalHours} />}

      <form.Subscribe
        selector={(st) => ({ values: st.values, canSubmit: st.canSubmit })}
      >
        {({ values, canSubmit }) => {
          const formDirty =
            (settings !== null && settingsDirty(values, baseline)) ||
            accountPatch(values, baseline) !== null;
          const dirty = formDirty || hasDraft;
          return (
            <div
              className={cn(
                'sticky bottom-[calc(4rem+1px+env(safe-area-inset-bottom))] z-10 flex flex-wrap items-center justify-between gap-3 rounded-md border bg-sheet px-4 py-3 shadow-md md:bottom-4',
                dirty && 'border-status-pending/60',
              )}
            >
              <p
                role="status"
                className={cn(
                  'flex items-center gap-2 text-sm',
                  dirty ? 'font-medium' : 'text-muted-foreground',
                )}
              >
                {dirty ? (
                  <CircleAlert
                    className="size-4 text-status-pending"
                    aria-hidden
                  />
                ) : (
                  <Check className="size-4 text-status-enabled" aria-hidden />
                )}
                {t(dirty ? 'settings.dirty' : 'settings.pristine')}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  disabled={!dirty || save.isPending}
                  onClick={() => {
                    form.reset(baseline);
                    setDraftKey((k) => k + 1);
                    setHasDraft(false);
                  }}
                >
                  {t('settings.discard')}
                </Button>
                <Button
                  type="submit"
                  form={formId}
                  disabled={!formDirty || !canSubmit || save.isPending}
                  aria-busy={save.isPending || undefined}
                  className="px-4"
                >
                  {t(save.isPending ? 'settings.saving' : 'settings.save')}
                </Button>
              </div>
            </div>
          );
        }}
      </form.Subscribe>
    </div>
  );
}

function TestMail({ recipientCount }: { recipientCount: number }) {
  const t = useT();
  const send = useMutation({
    mutationFn: () => unwrap(api.api['test-mail'].$post()),
    onSuccess: () => toast.success(t('settings.testMailSent')),
    onError: (err) => toast.error(t.error(errorCode(err))),
  });
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <Button
        type="button"
        variant="outline"
        disabled={send.isPending}
        onClick={() => send.mutate()}
      >
        <Mail aria-hidden />
        {t(send.isPending ? 'settings.testMailSending' : 'settings.testMail')}
      </Button>
      <p className="text-sm text-muted-foreground">
        {t('settings.testMailHint', { n: recipientCount })}
      </p>
    </div>
  );
}

type CopyState = 'idle' | 'copied' | 'manual';

function selectNode(id: string): boolean {
  const el = document.getElementById(id);
  const sel = window.getSelection();
  if (!el || !sel) return false;
  const range = document.createRange();
  range.selectNodeContents(el);
  sel.removeAllRanges();
  sel.addRange(range);
  return true;
}

function CopyButton({
  value,
  targetId,
  describedBy,
}: {
  value: string;
  targetId: string;
  describedBy: string;
}) {
  const t = useT();
  const [state, setState] = useState<CopyState>('idle');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    let ok = false;
    try {
      await navigator.clipboard.writeText(value);
      ok = true;
    } catch {
      // No clipboard API (plain HTTP) or denied: fall back to selection.
    }
    if (!ok) {
      ok = selectNode(targetId);
      try {
        ok = ok && document.execCommand('copy');
      } catch {
        ok = false;
      }
    }
    clearTimeout(timer.current);
    if (!ok) {
      selectNode(targetId);
      setState('manual');
      return;
    }
    setState('copied');
    timer.current = setTimeout(() => setState('idle'), 2000);
  };
  const copied = state === 'copied';
  return (
    <>
      <Button
        type="button"
        variant="outline"
        aria-label={copied ? undefined : t('settings.copyCallback')}
        aria-describedby={describedBy}
        onClick={() => void copy()}
      >
        {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
        {t(copied ? 'settings.copied' : 'settings.copy')}
      </Button>
      <span role="status" className="sr-only">
        {copied
          ? t('settings.copied')
          : state === 'manual'
            ? t('settings.copyManual')
            : ''}
      </span>
      {state === 'manual' && (
        <p aria-hidden className="basis-full text-sm text-muted-foreground">
          {t('settings.copyManual')}
        </p>
      )}
    </>
  );
}

function RecipientsField({
  value,
  onChange,
  onDraftChange,
  errors,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  onDraftChange: (has: boolean) => void;
  errors: unknown[];
}) {
  const t = useT();
  const uid = useId();
  const [draft, setDraft] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const add = () => {
    const p = recipientProblem(draft, value);
    if (p) {
      setProblem(
        t(
          p === 'invalid'
            ? 'settings.recipientInvalid'
            : 'settings.recipientDuplicate',
        ),
      );
      return;
    }
    onChange([...value, normalizeRecipient(draft)]);
    setDraft('');
    onDraftChange(false);
    setProblem(null);
  };

  return (
    <fieldset className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1.5">
      <legend className="mb-1.5 text-sm font-medium">
        {t('settings.recipients')}
      </legend>
      <p className="text-sm text-muted-foreground">
        {t('settings.recipientsHint')}
      </p>
      {value.length > 0 && (
        <ul className="divide-y divide-rule surface">
          {value.map((r) => (
            <li key={r} className="flex items-center gap-2 py-1 pr-1 pl-3">
              <span className="min-w-0 flex-1 truncate text-sm">{r}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t('settings.recipientRemove', { email: r })}
                onClick={() => onChange(value.filter((x) => x !== r))}
              >
                <X aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <Input
          id={`${uid}-new`}
          type="email"
          autoComplete="email"
          aria-label={t('settings.recipientNew')}
          placeholder={t('settings.recipientPlaceholder')}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            onDraftChange(e.target.value.trim() !== '');
            setProblem(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem ? `${uid}-err` : undefined}
          className="min-w-0 flex-1"
        />
        <Button type="button" variant="outline" onClick={add}>
          <Plus aria-hidden />
          {t('settings.recipientAdd')}
        </Button>
      </div>
      <FieldError id={`${uid}-err`} errors={problem ? [problem] : errors} />
    </fieldset>
  );
}
