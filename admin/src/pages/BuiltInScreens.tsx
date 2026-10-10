import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, type BuiltInScreen } from '../supabase';

/**
 * The 10 screens that ship with the app. The admin can reorder them,
 * switch any of them off (which removes it from the flow without losing
 * its config), and edit every question and option on them.
 *
 * 'Name' is not removable — saveMyProfile needs a name.
 */
export default function BuiltInScreens() {
  const [screens, setScreens] = useState<BuiltInScreen[]>([]);
  const [counts, setCounts] = useState<Record<string, { total: number; edited: number }>>({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setErr(null);
    const [cfg, texts] = await Promise.all([
      supabase
        .from('onboarding_screen_config')
        .select('*')
        .order('position', { ascending: true }),
      supabase.from('onboarding_text').select('screen_key, override_text'),
    ]);

    if (cfg.error) {
      setErr(cfg.error.message);
      setScreens([]);
    } else {
      setScreens((cfg.data ?? []) as BuiltInScreen[]);
    }

    if (!texts.error && Array.isArray(texts.data)) {
      const next: Record<string, { total: number; edited: number }> = {};
      for (const row of texts.data as Array<{ screen_key: string; override_text: string | null }>) {
        const bucket = next[row.screen_key] ?? { total: 0, edited: 0 };
        bucket.total += 1;
        if (row.override_text) bucket.edited += 1;
        next[row.screen_key] = bucket;
      }
      setCounts(next);
    }
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const toggleActive = async (s: BuiltInScreen) => {
    if (!s.is_removable && s.is_active) {
      window.alert(`"${s.label}" cannot be removed — the app needs a name to create a profile.`);
      return;
    }
    const { error } = await supabase
      .from('onboarding_screen_config')
      .update({ is_active: !s.is_active, updated_at: new Date().toISOString() })
      .eq('screen_key', s.screen_key);
    if (error) setErr(error.message);
    else void load();
  };

  const move = async (s: BuiltInScreen, dir: -1 | 1) => {
    const idx = screens.findIndex((x) => x.screen_key === s.screen_key);
    const target = screens[idx + dir];
    if (!target) return;
    const a = supabase
      .from('onboarding_screen_config')
      .update({ position: target.position, updated_at: new Date().toISOString() })
      .eq('screen_key', s.screen_key);
    const b = supabase
      .from('onboarding_screen_config')
      .update({ position: s.position, updated_at: new Date().toISOString() })
      .eq('screen_key', target.screen_key);
    const [ra, rb] = await Promise.all([a, b]);
    if (ra.error || rb.error) setErr((ra.error ?? rb.error)!.message);
    else void load();
  };

  if (loading) return <div className="card">Loading…</div>;
  if (err) return <div className="card err">{err}</div>;

  return (
    <div>
      <div className="card">
        <div className="small">
          These are the screens that ship with the app. Switch one off to take it out of
          onboarding, drag the order with the arrows, or open it to edit its questions and
          options. Scoring is tied to the option slot, not its wording — so rewording an
          option never changes what it scores.
        </div>
      </div>

      {screens.map((s, i) => {
        const c = counts[s.screen_key];
        return (
          <div key={s.screen_key} className="card">
            <div className="row">
              <div>
                <div style={{ fontWeight: 600 }}>
                  {i + 1}. {s.label}
                </div>
                <div className="small">
                  {s.screen_key}
                  {c ? ` · ${c.total} editable strings${c.edited ? `, ${c.edited} edited` : ''}` : ''}
                </div>
              </div>
              <div className="spacer" />
              <span className={`badge ${s.is_active ? 'active' : 'inactive'}`}>
                {s.is_active ? 'in the flow' : 'removed'}
              </span>
              {!s.is_removable ? <span className="badge required">always on</span> : null}
            </div>

            <div className="row" style={{ marginTop: 14 }}>
              <Link to={`/builtin/${s.screen_key}`}>
                <button className="secondary">Edit questions &amp; options</button>
              </Link>
              <button
                className="secondary"
                onClick={() => void toggleActive(s)}
                disabled={!s.is_removable && s.is_active}
              >
                {s.is_active ? 'Remove from flow' : 'Add back to flow'}
              </button>
              <div className="spacer" />
              <button className="secondary" onClick={() => void move(s, -1)} disabled={i === 0}>
                ↑
              </button>
              <button
                className="secondary"
                onClick={() => void move(s, 1)}
                disabled={i === screens.length - 1}
              >
                ↓
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
