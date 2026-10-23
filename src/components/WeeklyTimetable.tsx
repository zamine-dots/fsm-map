import { useMemo, useState } from 'react';
import { CalendarDays, CalendarPlus, List } from 'lucide-react';
import type { ScheduledClass, Weekday } from '../data/types';
import { compareClasses, conflictingIdsForDay, timeToMinutes, WEEKDAYS, type CampusClock } from '../lib/schedule';
import ScheduledClassCard from './ScheduledClassCard';

export default function WeeklyTimetable({ classes, clock, selectedDay, onDayChange, onDelete }: {
  classes: ScheduledClass[]; clock: CampusClock; selectedDay: Weekday; onDayChange: (day: Weekday) => void; onDelete: (course: ScheduledClass) => void;
}) {
  const [view, setView] = useState<'day' | 'week'>('day');
  const days = useMemo(() => WEEKDAYS.map((day) => ({
    ...day, classes: classes.filter((course) => course.days.includes(day.value)).sort(compareClasses), conflicts: conflictingIdsForDay(classes, day.value),
  })), [classes]);

  return <section className="nav-timetable" data-timetable-view={view} aria-label="Emploi du temps">
    <div className="nav-timetable-toolbar">
      <button type="button" className="nav-text-button" onClick={() => { onDayChange(clock.weekday); setView('day'); }}>Aujourd’hui</button>
      <div className="nav-segmented-control" role="group" aria-label="Affichage du planning">
        <button type="button" aria-pressed={view === 'day'} onClick={() => setView('day')}><List size={16} /><span>Jour</span></button>
        <button type="button" aria-pressed={view === 'week'} onClick={() => setView('week')}><CalendarDays size={16} /><span>Semaine</span></button>
      </div>
    </div>
    {view === 'day' && <div className="nav-day-picker" role="group" aria-label="Jour affiché">
      {days.map((day) => <button key={day.value} type="button" aria-pressed={selectedDay === day.value} aria-label={`${day.label}, ${day.classes.length} cours`} onClick={() => onDayChange(day.value)} data-today={clock.weekday === day.value}>
        <span>{day.short}</span><strong>{day.classes.length}</strong>{clock.weekday === day.value && <span className="sr-only">Aujourd’hui</span>}
      </button>)}
    </div>}
    <div className="nav-timetable-days">
      {days.filter((day) => view === 'week' || day.value === selectedDay).map((day) => <section className="nav-timetable-day" key={day.value} aria-labelledby={`timetable-day-${day.value}`}>
        <h3 className="nav-timetable-day-heading" id={`timetable-day-${day.value}`}>{day.label}{clock.weekday === day.value && <span>Aujourd’hui</span>}</h3>
        <div className="nav-day-sessions">{day.classes.length ? day.classes.map((course) => <ScheduledClassCard key={course.id} course={course} conflict={day.conflicts.has(course.id)}
          current={clock.weekday === day.value && timeToMinutes(course.startTime) <= clock.minuteOfDay && timeToMinutes(course.endTime) > clock.minuteOfDay} onDelete={onDelete} />) : <div className="nav-day-empty">{!classes.length && view === 'day' && <CalendarPlus size={32} strokeWidth={1.4} />}<p>{!classes.length && view === 'day' ? 'Ajoutez votre premier cours' : 'Aucun cours'}</p></div>}</div>
      </section>)}
    </div>
  </section>;
}
