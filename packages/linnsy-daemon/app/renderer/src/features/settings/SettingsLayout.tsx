import React from 'react';

export function SettingsSection(props: {
  title?: string;
  description?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  const showHeader = props.title !== undefined || props.description !== undefined;

  return (
    <section className="settings-section">
      {showHeader ? (
        <header className="settings-section-header">
          {props.title === undefined ? null : <h3>{props.title}</h3>}
          {props.description === undefined ? null : <p>{props.description}</p>}
        </header>
      ) : null}
      <div className="settings-section-body">
        {props.children}
      </div>
    </section>
  );
}

export function SettingRow(props: {
  label: string;
  description: React.ReactNode;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="setting-row">
      <div className="field-info">
        <div className="field-label">{props.label}</div>
        <div className="field-desc">{props.description}</div>
      </div>
      {props.children}
    </div>
  );
}
