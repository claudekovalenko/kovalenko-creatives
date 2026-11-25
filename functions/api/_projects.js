// All client projects — add new ones here
export const PROJECTS = {
  'jpn-mvp': {
    id: 'jpn-mvp',
    name: 'Jesus People Network MVP',
    client: 'Craig',
    code: 'JPN2026',
  },
  'oahu-seminary': { id: 'oahu-seminary', name: 'Oahu Theological Seminary website', client: 'Oahu Theological Seminary', code: 'OAHU2026' },
  'nn-website': { id: 'nn-website', name: 'Neighbors & Nations website', client: 'Neighbors & Nations', code: 'NN2026' },
  'nn-reading': { id: 'nn-reading', name: 'Neighbors & Nations reading plan', client: 'Neighbors & Nations', code: 'NNREAD2026' },
  'redeemer-kona': { id: 'redeemer-kona', name: 'Redeemer Church website', client: 'Redeemer Church, Kailua-Kona', code: 'REDEEMER2026' },
};

export const projectByCode = code => Object.values(PROJECTS).find(p => p.code === String(code || '').trim().toUpperCase()) || null;
