import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase, type OnboardingText } from '../supabase';

/**
 * Edit every question prompt and option label on one built-in screen.
 *
 * Leaving a field blank keeps the shipped default. A saved override
 * replaces that string in the app for every language, and takes effect
 * the next time a user starts onboarding — no app rebuild needed.
 */
export default function ScreenTextEditor() {
  const { screenKey } = useParams<{ screenKey: string }>();
  const navigate = useNavigate();

  const [rows, setRows] = useState<OnboardingText[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [label, setLabel] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const load = async () => {
    if (!screenKey) return;
    setLoading(true);
    const [textRes, cfgRes] = await Promise.all([
      supabase
        .from('onboarding_text')
        .select('*')
        .eq('screen_key', screenKey)
        .order('sort_order', { ascending: true }),
      supabase
        .from('onboarding_screen_config')
        .select('label')
        .eq('screen_key', screenKey)
        .maybeSingle(),
    ]);

    if (textRes.error) {
      setErr(textRes.error.message);
    } else {
      const data = (textRes.data ?? []) as OnboardingText[];
      setRows(data);
      const d: Record<string, string> = {};
      for (const r of data) d[r.i18n_key] = r.override_text ?? '';
      setDrafts(d);
    }
    if (!cfgRes.error && cfgRes.data) {
      setLabel((cfgRes.data as { label: string }).label);
    }
    setLoading(false);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screenKey]);

  const dirty = rows.some((r) => (drafts[r.i18n_key] ?? '') !== (r.override_text ?? ''));

  const saveAll = async () => {
    setSaving(true);
    setErr(null);
    const changed = rows.filter(
      (r) => (drafts[r.i18n_key] ?? '') !== (r.override_text ?? ''),
    );

    for (const r of changed) {
      const next = (drafts[r.i18n_key] ?? '').trim();
      const { error } = await supabase
        .from('onboarding_text')
        .update({
          override_text: next.length > 0 ? next : null,
          updated_at: new Date().toISOString(),
        })
        .eq('i18n_key', r.i18n_key);
      if (error) {
        setErr(`${r.field_label}: ${error.message}`);
        setSaving(false);
        return;
      }
    }

    setSaving(false);
    setSavedAt(new Date().toLocaleTimeString());
    void load();
  };

  const resetOne = (key: string) => {
    setDrafts({ ...drafts, [key]: '' });
  };

  if (loading) return <div className="card">Loading…</div>;

  return (
    <div>
      <div className="card">
        <div className="row">
          <div>
            <h2 style={{ margin: 0 }}>{label || screenKey}</h2>
            <div className="small" style={{ marginTop: 4 }}>
              {rows.length} editable strings. Leave a box empty to keep the shipped wording.
            </div>
          </div>
          <div className="spacer" />
          <button className="secondary" onClick={() => navigate('/builtin')} type="button">
            Back
          </button>
          <button onClick={() => void saveAll()} disabled={!dirty || saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
        {err ? <div className="err">{err}</div> : null}
        {savedAt && !dirty ? <div className="ok">Saved at {savedAt}.</div> : null}
      </div>

      {rows.map((r) => {
        const value = drafts[r.i18n_key] ?? '';
        const overridden = value.trim().length > 0;
        return (
          <div key={r.i18n_key} className="card">
            <div className="row">
              <div style={{ fontWeight: 600, fontSize: 14 }}>{r.field_label}</div>
              <div className="spacer" />
              {overridden ? <span className="badge required">edited</span> : null}
            </div>
            <div className="small" style={{ marginTop: 6, marginBottom: 10 }}>
              Default: {r.default_text}
            </div>
            <textarea
              rows={Math.min(4, Math.max(2, Math.ceil(r.default_text.length / 70)))}
              value={value}
              placeholder="Leave empty to use the default above"
              onChange={(e) => setDrafts({ ...drafts, [r.i18n_key]: e.target.value })}
            />
            {overridden ? (
              <div style={{ marginTop: 8 }}>
                <button
                  className="secondary"
                  type="button"
                  onClick={() => resetOne(r.i18n_key)}
                >
                  Reset to default
                </button>
              </div>
            ) : null}
          </div>
        );
      })}

      <div className="card">
        <div className="row">
          <div className="spacer" />
          <button onClick={() => void saveAll()} disabled={!dirty || saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
