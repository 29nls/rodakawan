import { milestoneStatusLabels, milestones } from '@/constants/roadmap';

describe('data roadmap', () => {
  it('punya ID unik dan tidak kosong', () => {
    const ids = milestones.map((milestone) => milestone.id);
    expect(new Set(ids).size).toBe(ids.length);
    ids.forEach((id) => expect(id).toMatch(/^M\d+$/));
  });

  it('memakai fase dan status yang dikenali', () => {
    milestones.forEach((milestone) => {
      expect(['P0', 'P1', 'P2']).toContain(milestone.phase);
      expect(Object.keys(milestoneStatusLabels)).toContain(milestone.status);
    });
  });

  it('menandai tepat satu milestone fondasi (M0)', () => {
    const foundation = milestones.filter((milestone) => milestone.status === 'pondasi');
    expect(foundation).toHaveLength(1);
    expect(foundation[0]?.id).toBe('M0');
  });

  it('menjaga urutan fase P0 sebelum P1 dan P2', () => {
    const phaseOrder = milestones.map((milestone) => milestone.phase);
    const lastP0 = phaseOrder.lastIndexOf('P0');
    const firstP1 = phaseOrder.indexOf('P1');
    const firstP2 = phaseOrder.indexOf('P2');

    expect(lastP0).toBeGreaterThanOrEqual(0);
    if (firstP1 !== -1) expect(firstP1).toBeGreaterThan(lastP0);
    if (firstP2 !== -1) expect(firstP2).toBeGreaterThan(lastP0);
  });
});
