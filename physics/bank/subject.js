// Physics edition of the Text Test Builder: subject strings read by Text Test Builder.html (see tools/patch_subject.txt).
window.SUBJECT = {
  name: 'Physics', app: 'Physics Test Builder', defaultTitle: 'Physics Review', storage: 'ptb.', newPrefix: 'PSP',
  oldEdition: '2006', newEdition: '2025',
  renderer: {
    tableNames: {   // the 2006-edition items the 2025 reference tables no longer offer (see Reference Tables6-vs-2025.md)
      'FRICT': 'Coefficients of friction table', 'EQ-FRICT': 'Ff = μFN', 'REFRACT': 'Indices of refraction table',
      'RESIST': 'Resistivities table', 'EQ-RESIST': 'R = ρL/A', 'ENERGYLVL': 'Energy level diagrams (H, Hg)', 'EQ-LEVELS': 'Ephoton = Ei − Ef',
      'STDMODEL': 'Standard Model chart', 'CONST-MASS': 'Rest masses of electron, proton, neutron', 'CONST-ASTRO': 'Earth/Moon mass, radius, distances',
      'CONST-U': '1 u = 931 MeV', 'EQ-MC2': 'E = mc²', 'EQ-HOOKE': 'Fs = kx', 'GEOM': 'Area formulas (bh, ½bh, πr²)',
    },

    note: 'Some questions may require the use of the Reference Tables for Physical Setting/Physics.',
    refHeader: '(items the 2025 edition no longer offers; students need the 2006 tables or the values given)',
    refNone: 'none: everything needed is on the 2025 edition', refFirst: 'ZZ', refSkip: null,
  },
};
