import React, { useId, useMemo, useState } from 'react';

import type { CreateCronInput } from '../../lib/daemon-api.js';
import { ActionButtons } from '../../components/ActionButtons.js';
import { AppDialog } from '../../components/AppDialog.js';
import { CustomNumberInput } from '../../components/CustomNumberInput.js';
import { CustomSelect, type CustomSelectOption } from '../../components/CustomSelect.js';
import { SimpleDatePicker } from '../../components/SimpleDatePicker.js';
import { TimePicker } from '../../components/TimePicker.js';
import { t, type Locale } from '../../lib/i18n.js';
import {
  buildCreateCronInput,
  createDefaultCronFormValues,
  getWeekdayOptionText,
  type CreateScheduleKind,
  type IntervalUnit
} from './create-cron-form.js';

export function CreateCronDialog(props: {
  locale: Locale;
  onCancel(): void;
  onSubmit(input: CreateCronInput): void;
}): React.JSX.Element {
  const defaults = createDefaultCronFormValues();
  const [query, setQuery] = useState('');
  const [scheduleKind, setScheduleKind] = useState<CreateScheduleKind>('one_shot');
  const [date, setDate] = useState(defaults.date);
  const [time, setTime] = useState(defaults.time);
  const [dayOfWeek, setDayOfWeek] = useState(String(defaults.dayOfWeek));
  const [intervalValue, setIntervalValue] = useState('1');
  const [intervalUnit, setIntervalUnit] = useState<IntervalUnit>('hours');
  const [error, setError] = useState<string | null>(null);
  const intervalValueInputId = useId();

  const scheduleKindOptions = useMemo((): ReadonlyArray<CustomSelectOption<CreateScheduleKind>> => [
    { value: 'one_shot', text: t(props.locale, 'cronCreateOneShot') },
    { value: 'daily', text: t(props.locale, 'cronCreateDaily') },
    { value: 'weekly', text: t(props.locale, 'cronCreateWeekly') },
    { value: 'interval', text: t(props.locale, 'cronCreateInterval') }
  ], [props.locale]);

  const weekdayOptions = useMemo((): ReadonlyArray<CustomSelectOption<string>> => (
    Array.from({ length: 7 }, (_, index) => ({
      value: String(index),
      text: getWeekdayOptionText(props.locale, index)
    }))
  ), [props.locale]);

  const intervalUnitOptions = useMemo((): ReadonlyArray<CustomSelectOption<IntervalUnit>> => [
    { value: 'minutes', text: t(props.locale, 'cronCreateIntervalMinutes') },
    { value: 'hours', text: t(props.locale, 'cronCreateIntervalHours') }
  ], [props.locale]);

  function submit(): void {
    const input = buildCreateCronInput({
      query,
      scheduleKind,
      date,
      time,
      dayOfWeek,
      intervalValue,
      intervalUnit
    });
    if (input === null) {
      setError(t(props.locale, 'cronCreateInvalid'));
      return;
    }
    setError(null);
    props.onSubmit(input);
  }

  return (
    <AppDialog
      ariaLabel={t(props.locale, 'cronCreateTitle')}
      closeLabel={t(props.locale, 'confirmCancelAction')}
      footer={({ requestClose }) => (
        <ActionButtons
          onPrimaryAction={submit}
          onSecondaryAction={requestClose}
          primaryActionText={t(props.locale, 'cronCreateSubmit')}
          secondaryActionText={t(props.locale, 'confirmCancelAction')}
          showSecondaryAction={true}
          size="sm"
        />
      )}
      onClose={() => {
        props.onCancel();
      }}
      showCloseButton={true}
      title={t(props.locale, 'cronCreateTitle')}
    >
      <div className="cron-create-form">
        <div className="cron-create-field cron-create-field--full">
          <span className="cron-create-field-caption">{t(props.locale, 'cronCreateQueryLabel')}</span>
          <textarea
            aria-label={t(props.locale, 'cronCreateQueryLabel')}
            className="cron-create-query-textarea scroll-area"
            onChange={(event) => {
              setQuery(event.currentTarget.value);
            }}
            placeholder={t(props.locale, 'cronCreateQueryPlaceholder')}
            value={query}
          />
        </div>
        <div className="cron-create-field cron-create-field--full">
          <span className="cron-create-field-caption">{t(props.locale, 'cronCreateScheduleLabel')}</span>
          <CustomSelect
            ariaLabel={t(props.locale, 'cronCreateScheduleLabel')}
            fallbackPlaceholder={t(props.locale, 'customSelectPlaceholder')}
            fallbackTitle={t(props.locale, 'customSelectTitle')}
            minWidth="100%"
            portal={true}
            options={scheduleKindOptions}
            title={t(props.locale, 'cronCreateScheduleLabel')}
            value={scheduleKind}
            width="100%"
            onChange={(value) => {
              setScheduleKind(value);
            }}
          />
        </div>
        {scheduleKind === 'one_shot' ? (
          <>
            <div className="cron-create-field">
              <span className="cron-create-field-caption">{t(props.locale, 'cronCreateDateLabel')}</span>
              <SimpleDatePicker
                ariaLabel={t(props.locale, 'cronCreateDateLabel')}
                locale={props.locale}
                portal={true}
                value={date}
                onChange={(next) => {
                  setDate(next);
                }}
              />
            </div>
            <div className="cron-create-field">
              <span className="cron-create-field-caption">{t(props.locale, 'cronCreateTimeLabel')}</span>
              <TimePicker
                ariaLabel={t(props.locale, 'cronCreateTimeLabel')}
                locale={props.locale}
                portal={true}
                value={time}
                onChange={(next) => {
                  setTime(next);
                }}
              />
            </div>
          </>
        ) : null}
        {scheduleKind === 'daily' ? (
          <div className="cron-create-field cron-create-field--full">
            <span className="cron-create-field-caption">{t(props.locale, 'cronCreateTimeLabel')}</span>
            <TimePicker
              ariaLabel={t(props.locale, 'cronCreateTimeLabel')}
              locale={props.locale}
              portal={true}
              value={time}
              onChange={(next) => {
                setTime(next);
              }}
            />
          </div>
        ) : null}
        {scheduleKind === 'weekly' ? (
          <>
            <div className="cron-create-field">
              <span className="cron-create-field-caption">{t(props.locale, 'cronCreateWeekdayLabel')}</span>
              <CustomSelect
                ariaLabel={t(props.locale, 'cronCreateWeekdayLabel')}
                fallbackPlaceholder={t(props.locale, 'customSelectPlaceholder')}
                fallbackTitle={t(props.locale, 'customSelectTitle')}
                minWidth="100%"
                portal={true}
                options={weekdayOptions}
                title={t(props.locale, 'cronCreateWeekdayLabel')}
                value={dayOfWeek}
                width="100%"
                onChange={(value) => {
                  setDayOfWeek(value);
                }}
              />
            </div>
            <div className="cron-create-field">
              <span className="cron-create-field-caption">{t(props.locale, 'cronCreateTimeLabel')}</span>
              <TimePicker
                ariaLabel={t(props.locale, 'cronCreateTimeLabel')}
                locale={props.locale}
                portal={true}
                value={time}
                onChange={(next) => {
                  setTime(next);
                }}
              />
            </div>
          </>
        ) : null}
        {scheduleKind === 'interval' ? (
          <>
            <div className="cron-create-field">
              <label className="cron-create-field-caption" htmlFor={intervalValueInputId}>
                {t(props.locale, 'cronCreateIntervalValueLabel')}
              </label>
              <CustomNumberInput
                ariaLabel={t(props.locale, 'cronCreateIntervalValueLabel')}
                fullWidth={true}
                id={intervalValueInputId}
                locale={props.locale}
                min={1}
                showSpinButtons={true}
                step={1}
                value={intervalValue}
                onChange={(next) => {
                  setIntervalValue(next);
                }}
              />
            </div>
            <div className="cron-create-field">
              <span className="cron-create-field-caption">{t(props.locale, 'cronCreateIntervalUnitLabel')}</span>
              <CustomSelect
                ariaLabel={t(props.locale, 'cronCreateIntervalUnitLabel')}
                fallbackPlaceholder={t(props.locale, 'customSelectPlaceholder')}
                fallbackTitle={t(props.locale, 'customSelectTitle')}
                minWidth="100%"
                portal={true}
                options={intervalUnitOptions}
                title={t(props.locale, 'cronCreateIntervalUnitLabel')}
                value={intervalUnit}
                width="100%"
                onChange={(value) => {
                  setIntervalUnit(value);
                }}
              />
            </div>
          </>
        ) : null}
        {error === null ? null : <p className="cron-create-error">{error}</p>}
      </div>
    </AppDialog>
  );
}
