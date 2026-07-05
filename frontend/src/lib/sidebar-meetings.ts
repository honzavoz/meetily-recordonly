export interface SidebarMeetingListItem {
  id: string;
  title: string;
  type: 'file';
  createdAt?: string | null;
  updatedAt?: string | null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatSidebarDateTime(value?: string | number | null): string {
  if (value === null || value === undefined || value === '') {
    return '';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const month = MONTHS[date.getMonth()];
  const day = date.getDate();
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');

  return `${month} ${day}, ${hours}:${minutes}`;
}

export function getSidebarMeetingSubtitle(
  meeting: Pick<SidebarMeetingListItem, 'createdAt'>,
): string {
  return formatSidebarDateTime(meeting.createdAt);
}

export function filterSidebarMeetings<T extends Pick<SidebarMeetingListItem, 'title' | 'createdAt'>>(
  meetings: T[],
  query: string,
): T[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return meetings;
  }

  return meetings.filter((meeting) => {
    const searchableText = [
      meeting.title,
      getSidebarMeetingSubtitle(meeting),
    ].join(' ').toLowerCase();

    return searchableText.includes(normalizedQuery);
  });
}
