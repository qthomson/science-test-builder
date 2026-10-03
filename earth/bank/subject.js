// Earth Science edition of the merged Science Test Builder: subject strings read by index.html (see tools/patch_subject.txt).
window.SUBJECT = {
  name: 'Earth Science', app: 'Earth Science Test Builder', defaultTitle: 'Earth Science Review', storage: 'etb.', newPrefix: 'ESS',
  oldEdition: '2011', newEdition: '2026',
  renderer: {
    tableNames: {   // 2011 ESRT items the 2026 ESS reference tables dropped or cut (Analysis/reference-tables-2011-vs-2026.md)
      'EQ': 'Equations (eccentricity, gradient, rate of change)', 'SPHEAT': 'Specific heats', 'WATER': 'Properties of water',
      'COMP': 'Chemical composition of crust, hydrosphere, troposphere', 'PARTICLE': 'Particle size vs water velocity graph',
      'SEDIMENTARY': 'Sedimentary rock identification scheme', 'METAMORPHIC': 'Metamorphic rock identification scheme',
      'PSWAVE': 'P-wave and S-wave travel time graph', 'DEWPOINT': 'Dewpoint table', 'RH': 'Relative humidity table',
      'TEMPSCALE': 'Temperature scales', 'PRESSCALE': 'Pressure scales', 'CURRENTS': 'Surface ocean currents (2011)',
      'PLATES': 'Tectonic plates map (2011)', 'IGNEOUS': 'Igneous rock scheme (texture)', 'GEOHIST': 'Geologic history of NYS (2011)',
      'INTERIOR': "Earth's interior properties (2011)", 'WXSYMBOLS': 'Weather map symbols (air masses, precipitation)',
      'WINDBELTS': 'Planetary wind belts (2011)', 'ATMOSPHERE': 'Properties of the atmosphere', 'STARS': 'Characteristics of stars (2011)',
      'SOLARSYS': 'Solar system data (mass, density)', 'MINERALS': 'Properties of common minerals (2011)', 'EMSPECTRUM': 'Electromagnetic spectrum (2011)',
    },
    note: 'Some questions may require the use of the Reference Tables for Physical Setting/Earth Science.',
    refHeader: '(items the 2026 edition no longer offers; students need the 2011 tables or the values given)',
    refNone: 'none: everything needed is on the 2026 edition', refFirst: 'ZZ', refSkip: null,
  },
};
