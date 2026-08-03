import { beforeEach, expect, mock, test } from 'bun:test';

const invokeMock = mock(async () => ({
  id: 'project-1',
  name: 'YachtNet',
  normalized_name: 'yachtnet',
  color: 'emerald',
}));

mock.module('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

const { projectService } = await import('@/services/projectService');

beforeEach(() => invokeMock.mockClear());

test('maps project colors and updates them through the Tauri command', async () => {
  const project = await projectService.updateColor('project-1', 'emerald');

  expect(invokeMock).toHaveBeenCalledWith('api_update_project_color', {
    projectId: 'project-1',
    color: 'emerald',
  });
  expect(project.color).toBe('emerald');
});
