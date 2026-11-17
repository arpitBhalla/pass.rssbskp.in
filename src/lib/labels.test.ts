import { describe, expect, it } from 'vitest';
import { fieldLabel, type PassType } from '@/shared/types';
import { exportTable, planImport } from './csv';
import { blankPass } from './passes';

describe('Referred by', () => {
  it('is what Gate 3, Gate 3 - VIP and Admin call the Incharge column; the rest keep Incharge', () => {
    expect((['gate3-entry', 'vip-gate', 'admin'] as PassType[]).map((t) => fieldLabel(t, 'incharge'))).toEqual(['Referred by', 'Referred by', 'Referred by']);
    expect(fieldLabel('sewa-vehicle', 'incharge')).toBe('Incharge');
    expect(fieldLabel('admin', 'name')).toBe('Name');
  });
  it('is the export header, and a "Referred by" column imports into it', () => {
    const p = { ...blankPass('admin', 1), id: 1, name: 'RAM', incharge: 'SH. MEHTA', created_at: '2026-11-14T10:00:00Z' };
    const [head] = exportTable([p], 'admin');
    expect(head).toContain('Referred by');
    expect(head).not.toContain('Incharge');
    const plan = planImport([], 'admin', 'Sr. No.,Pass type,Name,Referred by\n0002,Admin,SHYAM,SH. MEHTA\n');
    expect(plan.create).toMatchObject([{ type: 'admin', serial: 2, values: { name: 'SHYAM', incharge: 'SH. MEHTA' } }]);
  });
});
