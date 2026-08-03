import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  filterMeetingsForProjectView,
  getProjectViewCount,
  normalizeProjectName,
  searchProjectMeetings,
} from "../../src/lib/meeting-projects.ts";

const yachtNet = { id: "yacht", name: "YachtNet", normalizedName: "yachtnet", meetingCount: 1 };
const internal = { id: "internal", name: "Interní", normalizedName: "interní", meetingCount: 1 };

const meetings = [
  { id: "older", title: "Planning", createdAt: "2026-08-01T10:00:00Z", projects: [] },
  { id: "newer", title: "Sprint", createdAt: "2026-08-03T10:00:00Z", projects: [yachtNet, internal] },
  { id: "newer", title: "Sprint duplicate", createdAt: "2026-08-03T10:00:00Z", projects: [yachtNet] },
];

describe("meeting project helpers", () => {
  test("normalizes project names like the backend", () => {
    assert.equal(normalizeProjectName("  ŽLUTÝ   Kůň "), "žlutý kůň");
  });

  test("All Meetings is unique and newest first", () => {
    const result = filterMeetingsForProjectView(meetings, { type: "all" });
    assert.deepEqual(result.map((meeting) => meeting.id), ["newer", "older"]);
  });

  test("Unassigned only includes meetings without projects", () => {
    const result = filterMeetingsForProjectView(meetings, { type: "unassigned" });
    assert.deepEqual(result.map((meeting) => meeting.id), ["older"]);
  });

  test("project view contains meetings assigned to that project", () => {
    const result = filterMeetingsForProjectView(meetings, { type: "project", projectId: "internal" });
    assert.deepEqual(result.map((meeting) => meeting.id), ["newer"]);
  });

  test("search matches project names as well as meeting titles", () => {
    assert.deepEqual(searchProjectMeetings(meetings, "yachtnet").map((meeting) => meeting.id), ["newer"]);
    assert.deepEqual(searchProjectMeetings(meetings, "planning").map((meeting) => meeting.id), ["older"]);
  });

  test("counts use unique meetings in each view", () => {
    assert.equal(getProjectViewCount(meetings, { type: "all" }), 2);
    assert.equal(getProjectViewCount(meetings, { type: "unassigned" }), 1);
    assert.equal(getProjectViewCount(meetings, { type: "project", projectId: "yacht" }), 1);
  });
});
