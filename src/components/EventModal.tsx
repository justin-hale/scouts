import type { CalendarEvent, Category } from "../types";
import { formatDateLong, formatTimeRange } from "../utils/dates";
import { Markdown } from "./Markdown";
import { Modal } from "./Modal";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 text-sm">
      <span className="w-20 shrink-0 font-medium text-slate-400">{label}</span>
      <span className="text-slate-700">{children}</span>
    </div>
  );
}

export function EventModal({
  event,
  category,
  canEdit,
  onClose,
  onEdit,
  onDelete,
}: {
  event: CalendarEvent;
  category?: Category;
  canEdit: boolean;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <Modal
      title={event.title}
      onClose={onClose}
      footer={
        canEdit ? (
          <div className="flex justify-between">
            <button
              onClick={onDelete}
              className="rounded-lg px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
            >
              Delete
            </button>
            <button
              onClick={onEdit}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
            >
              Edit event
            </button>
          </div>
        ) : undefined
      }
    >
      <div className="space-y-4">
        {category && (
          <span
            className="inline-block rounded-full px-2.5 py-1 text-xs font-semibold"
            style={{
              backgroundColor: `${category.color}1a`,
              color: category.color,
            }}
          >
            {category.name}
          </span>
        )}
        <div className="space-y-2">
          <Row label="When">{formatDateLong(event.date)}</Row>
          <Row label="Time">
            {formatTimeRange(event.allDay, event.startTime, event.endTime)}
          </Row>
          {event.location && <Row label="Where">{event.location}</Row>}
        </div>
        {event.description && (
          <div className="border-t border-slate-100 pt-4">
            <Markdown>{event.description}</Markdown>
          </div>
        )}
      </div>
    </Modal>
  );
}
