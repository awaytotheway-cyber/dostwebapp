import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase, type OnboardingScreen, type QuestionType } from '../supabase';

type Props = { mode: 'create' | 'edit' };

export default function ScreenForm({ mode }: Props) {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();

  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [position, setPosition] = useState(0);
  const [questionType, setQuestionType] = useState<QuestionType>('short_text');
  const [options, setOptions] = useState<string[]>(['', '']);
  const [isRequired, setIsRequired] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [loading, setLoading] = useState(mode === 'edit');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (mode === 'create') {
        const { data } = await supabase
          .from('admin_onboarding_screens')
          .select('position')
          .order('position', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (data && typeof data.position === 'number') {
          setPosition(data.position + 1);
        }
        setLoading(false);
        return;
      }
      if (!id) return;
      const { data, error } = await supabase
        .from('admin_onboarding_screens')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (error || !data) {
        setErr(error?.message ?? 'Not found.');
      } else {
        const s = data as OnboardingScreen;
        setTitle(s.title);
        setSubtitle(s.subtitle ?? '');
        setPosition(s.position);
        setQuestionType(s.question_type);
        setOptions(s.options?.map((o) => o.label) ?? ['', '']);
        setIsRequired(s.is_required);
        setIsActive(s.is_active);
      }
      setLoading(false);
    })();
  }, [mode, id]);

  const canSave =
    title.trim().length > 0 &&
    (questionType === 'short_text' ||
      options.filter((o) => o.trim().length > 0).length >= 2);

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setErr(null);
    const cleanedOptions =
      questionType === 'single_choice'
        ? options.map((o) => o.trim()).filter(Boolean).map((label) => ({ label }))
        : null;

    const row = {
      title: title.trim(),
      subtitle: subtitle.trim() || null,
      position,
      question_type: questionType,
      options: cleanedOptions,
      is_required: isRequired,
      is_active: isActive,
      updated_at: new Date().toISOString(),
    };

    const op =
      mode === 'edit' && id
        ? supabase.from('admin_onboarding_screens').update(row).eq('id', id)
        : supabase.from('admin_onboarding_screens').insert(row);

    const { error } = await op;
    setSaving(false);
    if (error) setErr(error.message);
    else navigate('/');
  };

  if (loading) return <div className="card">Loading…</div>;

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>{mode === 'edit' ? 'Edit screen' : 'New screen'}</h2>

      <label>Title (the question or prompt the user sees)</label>
      <input value={title} onChange={(e) => setTitle(e.target.value)} />

      <label>Subtitle (optional, shown under the title)</label>
      <input value={subtitle} onChange={(e) => setSubtitle(e.target.value)} />

      <label>Position (lower = earlier within the admin block)</label>
      <input
        type="number"
        value={position}
        onChange={(e) => setPosition(Number(e.target.value) || 0)}
      />

      <label>Question type</label>
      <select
        value={questionType}
        onChange={(e) => setQuestionType(e.target.value as QuestionType)}
      >
        <option value="short_text">Short text answer</option>
        <option value="single_choice">Single choice (pick one)</option>
      </select>

      {questionType === 'single_choice' ? (
        <div style={{ marginTop: 14 }}>
          <label style={{ marginTop: 0 }}>Options (at least 2)</label>
          {options.map((opt, i) => (
            <div key={i} className="option-row">
              <input
                value={opt}
                onChange={(e) => {
                  const next = options.slice();
                  next[i] = e.target.value;
                  setOptions(next);
                }}
                placeholder={`Option ${i + 1}`}
              />
              {options.length > 2 ? (
                <button
                  className="secondary"
                  onClick={() => setOptions(options.filter((_, idx) => idx !== i))}
                  type="button"
                >
                  Remove
                </button>
              ) : null}
            </div>
          ))}
          {options.length < 6 ? (
            <button
              className="secondary"
              onClick={() => setOptions([...options, ''])}
              type="button"
            >
              + Add option
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="row" style={{ marginTop: 20 }}>
        <label style={{ margin: 0 }}>
          <input
            type="checkbox"
            style={{ width: 'auto', marginRight: 6 }}
            checked={isRequired}
            onChange={(e) => setIsRequired(e.target.checked)}
          />
          Required
        </label>
        <label style={{ margin: 0 }}>
          <input
            type="checkbox"
            style={{ width: 'auto', marginRight: 6 }}
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
          />
          Active (shown to new users)
        </label>
      </div>

      {err ? <div className="err">{err}</div> : null}

      <div className="row" style={{ marginTop: 20 }}>
        <button className="secondary" onClick={() => navigate('/')} type="button">
          Cancel
        </button>
        <div className="spacer" />
        <button onClick={() => void save()} disabled={!canSave || saving}>
          {saving ? 'Saving…' : mode === 'edit' ? 'Save changes' : 'Create screen'}
        </button>
      </div>
    </div>
  );
}
