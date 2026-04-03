import React from 'react';
import cronstrue from 'cronstrue';
import './CronPicker.css';

const PRESETS: { label: string; value: string }[] = [
  { label: '— choose preset —',      value: ''            },
  { label: 'Every hour',             value: '0 * * * *'   },
  { label: 'Every 6 hours',          value: '0 */6 * * *' },
  { label: 'Daily at midnight',      value: '0 0 * * *'   },
  { label: 'Daily at 2 AM',          value: '0 2 * * *'   },
  { label: 'Weekdays at midnight',   value: '0 0 * * 1-5' },
  { label: 'Weekly (Sunday midnight)', value: '0 0 * * 0' },
  { label: 'Monthly (1st midnight)', value: '0 0 1 * *'   },
];

function parseParts(cron: string): [string, string, string, string, string] {
  const parts = cron.trim().split(/\s+/);
  while (parts.length < 5) { parts.push('*'); }
  return [parts[0], parts[1], parts[2], parts[3], parts[4]];
}

function safeDescribe(cron: string): string {
  try {
    return cronstrue.toString(cron, { use24HourTimeFormat: true });
  } catch {
    return 'Invalid cron expression';
  }
}

interface CronPickerProps {
  value: string;
  onChange: (val: string) => void;
}

export default function CronPicker({ value, onChange }: CronPickerProps): React.ReactElement {
  const effective = value || '0 0 * * *';
  const [minute, hour, day, month, weekday] = parseParts(effective);

  const emit = (m: string, h: string, d: string, mo: string, wd: string) =>
    onChange(`${m} ${h} ${d} ${mo} ${wd}`);

  const fields: { id: string; label: string; val: string; set: (v: string) => void }[] = [
    { id: 'min', label: 'Min',     val: minute,  set: (v) => emit(v, hour, day, month, weekday) },
    { id: 'hr',  label: 'Hour',    val: hour,    set: (v) => emit(minute, v, day, month, weekday) },
    { id: 'dom', label: 'Day',     val: day,     set: (v) => emit(minute, hour, v, month, weekday) },
    { id: 'mon', label: 'Month',   val: month,   set: (v) => emit(minute, hour, day, v, weekday) },
    { id: 'dow', label: 'Weekday', val: weekday, set: (v) => emit(minute, hour, day, month, v) },
  ];

  const matchedPreset = PRESETS.find((p) => p.value === effective)?.value ?? '';
  const description = safeDescribe(effective);

  return (
    <div className="cron-picker">
      <select
        className="cron-picker__preset"
        value={matchedPreset}
        onChange={(e) => { if (e.target.value) { onChange(e.target.value); } }}
        aria-label="Cron preset"
      >
        {PRESETS.map((p) => (
          <option key={p.value} value={p.value}>{p.label}</option>
        ))}
      </select>

      <div className="cron-picker__fields">
        {fields.map(({ id, label, val, set }) => (
          <div key={id} className="cron-picker__field">
            <span className="cron-picker__field-label">{label}</span>
            <input
              className="cron-picker__field-input"
              type="text"
              value={val}
              onChange={(e) => set(e.target.value)}
              aria-label={label}
              spellCheck={false}
            />
          </div>
        ))}
      </div>

      <div className="cron-picker__description" title={effective}>
        {description}
      </div>
    </div>
  );
}
