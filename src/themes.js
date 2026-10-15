// Material You dynamic color seeds — NO sky blue
// Surprise seed: Soft Violet (Material Expressive) + mixed Auto palette
import { applyVisualSkin, normalizeVisualTheme, paletteForVisual } from './visual-theme.js';
import { setIconPack } from './icons.js';

const SEEDS = {
  auto: {
    label: 'Auto',
    // Mixture: violet primary + coral accent + sage success (image-like Material You)
    light: {
      '--c0': '#f6f0f8',
      '--c1': '#fdf8ff',
      '--c2': '#ffffff',
      '--c3': '#f0e6f6',
      '--c4': '#e4d4ee',
      '--c5': '#d4bfe3',
      '--m3-primary': '#6750a4',
      '--m3-on-primary': '#ffffff',
      '--m3-primary-container': '#e9ddff',
      '--m3-on-primary-container': '#22005d',
      '--m3-secondary': '#c45c7a',
      '--m3-secondary-container': '#ffd9e2',
      '--m3-tertiary': '#4a7c59',
      '--m3-tertiary-container': '#c8ead0',
      '--m3-surface': '#fdf8ff',
      '--m3-surface-low': '#f6f0f8',
      '--m3-tonal': '#e9ddff',
      '--m3-outline': '#e4d4ee',
      '--t1': '#1d1a22',
      '--t2': '#4a4458',
      '--t3': '#7a7389',
      '--cyan': '#6750a4',
      '--green': '#4a7c59',
      '--purple': '#7c5cbf',
      '--pink': '#c45c7a',
      '--orange': '#c9784a',
      '--yellow': '#b89a3d',
    },
    dark: {
      '--c0': '#141218',
      '--c1': '#1c1b1f',
      '--c2': '#25232a',
      '--c3': '#2f2b35',
      '--c4': '#3d3746',
      '--c5': '#4e4658',
      '--m3-primary': '#d0bcff',
      '--m3-on-primary': '#381e72',
      '--m3-primary-container': '#4f378b',
      '--m3-on-primary-container': '#e9ddff',
      '--m3-secondary': '#ffb1c5',
      '--m3-secondary-container': '#8d3a55',
      '--m3-tertiary': '#a8d5b3',
      '--m3-tertiary-container': '#2f553a',
      '--m3-surface': '#1c1b1f',
      '--m3-surface-low': '#141218',
      '--m3-tonal': '#4f378b',
      '--m3-outline': '#3d3746',
      '--t1': '#e6e1e9',
      '--t2': '#cac4d0',
      '--t3': '#938f99',
      '--cyan': '#d0bcff',
      '--green': '#a8d5b3',
      '--purple': '#d0bcff',
      '--pink': '#ffb1c5',
      '--orange': '#ffb68a',
      '--yellow': '#e8c872',
    },
  },
  violet: {
    label: 'Violet',
    swatch: '#6750a4',
    light: {
      '--c0': '#f7f2fa', '--c1': '#fef7ff', '--c2': '#ffffff', '--c3': '#f3e8ff', '--c4': '#e8def8', '--c5': '#d0bcff',
      '--m3-primary': '#6750a4', '--m3-on-primary': '#ffffff',
      '--m3-primary-container': '#e9ddff', '--m3-on-primary-container': '#22005d',
      '--m3-secondary': '#625b71', '--m3-secondary-container': '#e8def8',
      '--m3-tertiary': '#7d5260', '--m3-tertiary-container': '#ffd8e4',
      '--m3-surface': '#fef7ff', '--m3-surface-low': '#f7f2fa', '--m3-tonal': '#e9ddff', '--m3-outline': '#e8def8',
      '--t1': '#1d1b20', '--t2': '#49454f', '--t3': '#79747e',
      '--cyan': '#6750a4', '--green': '#4a7c59', '--purple': '#7c5cbf', '--pink': '#7d5260', '--orange': '#8b5e3c', '--yellow': '#9a7b2f',
    },
    dark: {
      '--c0': '#141218', '--c1': '#1d1a22', '--c2': '#2b2930', '--c3': '#36343b', '--c4': '#49454f', '--c5': '#5e5866',
      '--m3-primary': '#d0bcff', '--m3-on-primary': '#381e72',
      '--m3-primary-container': '#4f378b', '--m3-on-primary-container': '#e9ddff',
      '--m3-secondary': '#ccc2dc', '--m3-secondary-container': '#4a4458',
      '--m3-tertiary': '#efb8c8', '--m3-tertiary-container': '#633b48',
      '--m3-surface': '#1d1a22', '--m3-surface-low': '#141218', '--m3-tonal': '#4f378b', '--m3-outline': '#49454f',
      '--t1': '#e6e1e9', '--t2': '#cac4d0', '--t3': '#938f99',
      '--cyan': '#d0bcff', '--green': '#a8d5b3', '--purple': '#d0bcff', '--pink': '#efb8c8', '--orange': '#ffb68a', '--yellow': '#e8c872',
    },
  },
  rose: {
    label: 'Rose',
    swatch: '#b3261e',
    light: {
      '--c0': '#fff8f7', '--c1': '#fffbff', '--c2': '#ffffff', '--c3': '#ffdad6', '--c4': '#ffb4ab', '--c5': '#f2b8b5',
      '--m3-primary': '#b3261e', '--m3-on-primary': '#ffffff',
      '--m3-primary-container': '#ffdad6', '--m3-on-primary-container': '#410002',
      '--m3-secondary': '#c45c7a', '--m3-secondary-container': '#ffd9e2',
      '--m3-tertiary': '#7d5260', '--m3-tertiary-container': '#ffd8e4',
      '--m3-surface': '#fffbff', '--m3-surface-low': '#fff8f7', '--m3-tonal': '#ffdad6', '--m3-outline': '#ffb4ab',
      '--t1': '#1c1b1f', '--t2': '#534341', '--t3': '#857370',
      '--cyan': '#b3261e', '--green': '#4a7c59', '--purple': '#7d5260', '--pink': '#c45c7a', '--orange': '#c9784a', '--yellow': '#b89a3d',
    },
    dark: {
      '--c0': '#1a1110', '--c1': '#201a19', '--c2': '#2c2221', '--c3': '#3b2c2a', '--c4': '#4e3b39', '--c5': '#634e4b',
      '--m3-primary': '#ffb4ab', '--m3-on-primary': '#690005',
      '--m3-primary-container': '#93000a', '--m3-on-primary-container': '#ffdad6',
      '--m3-secondary': '#ffb1c5', '--m3-secondary-container': '#8d3a55',
      '--m3-tertiary': '#efb8c8', '--m3-tertiary-container': '#633b48',
      '--m3-surface': '#201a19', '--m3-surface-low': '#1a1110', '--m3-tonal': '#93000a', '--m3-outline': '#4e3b39',
      '--t1': '#ece0de', '--t2': '#d0c3c1', '--t3': '#a08c89',
      '--cyan': '#ffb4ab', '--green': '#a8d5b3', '--purple': '#efb8c8', '--pink': '#ffb1c5', '--orange': '#ffb68a', '--yellow': '#e8c872',
    },
  },
  sage: {
    label: 'Sage',
    swatch: '#386a20',
    light: {
      '--c0': '#f3f6ef', '--c1': '#f8fbf3', '--c2': '#ffffff', '--c3': '#e4eed9', '--c4': '#c8e6b4', '--c5': '#a8d18e',
      '--m3-primary': '#386a20', '--m3-on-primary': '#ffffff',
      '--m3-primary-container': '#b8f397', '--m3-on-primary-container': '#072100',
      '--m3-secondary': '#4a7c59', '--m3-secondary-container': '#c8ead0',
      '--m3-tertiary': '#386665', '--m3-tertiary-container': '#bceceb',
      '--m3-surface': '#f8fbf3', '--m3-surface-low': '#f3f6ef', '--m3-tonal': '#b8f397', '--m3-outline': '#c8e6b4',
      '--t1': '#1a1c18', '--t2': '#424940', '--t3': '#72796f',
      '--cyan': '#386a20', '--green': '#4a7c59', '--purple': '#5b6b7a', '--pink': '#8b5a5a', '--orange': '#8b6a3c', '--yellow': '#8a7a2f',
    },
    dark: {
      '--c0': '#11140e', '--c1': '#1a1c18', '--c2': '#242822', '--c3': '#2f342c', '--c4': '#3f463b', '--c5': '#525a4c',
      '--m3-primary': '#9cd67d', '--m3-on-primary': '#143800',
      '--m3-primary-container': '#215107', '--m3-on-primary-container': '#b8f397',
      '--m3-secondary': '#a8d5b3', '--m3-secondary-container': '#2f553a',
      '--m3-tertiary': '#a0d0cf', '--m3-tertiary-container': '#1e4e4d',
      '--m3-surface': '#1a1c18', '--m3-surface-low': '#11140e', '--m3-tonal': '#215107', '--m3-outline': '#3f463b',
      '--t1': '#e2e3dc', '--t2': '#c2c9bc', '--t3': '#8b9388',
      '--cyan': '#9cd67d', '--green': '#a8d5b3', '--purple': '#b8c0d0', '--pink': '#e0b0b0', '--orange': '#e0c090', '--yellow': '#d8d080',
    },
  },
  ember: {
    label: 'Ember',
    swatch: '#9a4522',
    light: {
      '--c0': '#fff8f4', '--c1': '#fffbff', '--c2': '#ffffff', '--c3': '#ffdbcb', '--c4': '#ffb692', '--c5': '#f0a070',
      '--m3-primary': '#9a4522', '--m3-on-primary': '#ffffff',
      '--m3-primary-container': '#ffdbcb', '--m3-on-primary-container': '#351000',
      '--m3-secondary': '#c45c3a', '--m3-secondary-container': '#ffdad0',
      '--m3-tertiary': '#6b5b2e', '--m3-tertiary-container': '#f4e0a6',
      '--m3-surface': '#fffbff', '--m3-surface-low': '#fff8f4', '--m3-tonal': '#ffdbcb', '--m3-outline': '#ffb692',
      '--t1': '#201a17', '--t2': '#52443d', '--t3': '#85736a',
      '--cyan': '#9a4522', '--green': '#4a7c59', '--purple': '#7d5260', '--pink': '#c45c3a', '--orange': '#c9784a', '--yellow': '#b89a3d',
    },
    dark: {
      '--c0': '#1a120e', '--c1': '#201a17', '--c2': '#2c231e', '--c3': '#3b2f28', '--c4': '#4e3f36', '--c5': '#645045',
      '--m3-primary': '#ffb692', '--m3-on-primary': '#582000',
      '--m3-primary-container': '#7b2f0b', '--m3-on-primary-container': '#ffdbcb',
      '--m3-secondary': '#ffb4a0', '--m3-secondary-container': '#8c3a22',
      '--m3-tertiary': '#d7c48c', '--m3-tertiary-container': '#524419',
      '--m3-surface': '#201a17', '--m3-surface-low': '#1a120e', '--m3-tonal': '#7b2f0b', '--m3-outline': '#4e3f36',
      '--t1': '#ece0db', '--t2': '#d0c3bd', '--t3': '#a08c84',
      '--cyan': '#ffb692', '--green': '#a8d5b3', '--purple': '#efb8c8', '--pink': '#ffb4a0', '--orange': '#ffb68a', '--yellow': '#e8c872',
    },
  },
  teal: {
    label: 'Teal',
    swatch: '#006a6a',
  light: {
      '--c0': '#f0fafa', '--c1': '#f4fbfb', '--c2': '#ffffff', '--c3': '#cce8e8', '--c4': '#9ed4d4', '--c5': '#6cbdbd',
      '--m3-primary': '#006a6a', '--m3-on-primary': '#ffffff',
      '--m3-primary-container': '#6ff7f6', '--m3-on-primary-container': '#002020',
      '--m3-secondary': '#4a6363', '--m3-secondary-container': '#cce8e8',
      '--m3-tertiary': '#4b607c', '--m3-tertiary-container': '#d3e4ff',
      '--m3-surface': '#f4fbfb', '--m3-surface-low': '#f0fafa', '--m3-tonal': '#6ff7f6', '--m3-outline': '#9ed4d4',
      '--t1': '#191c1c', '--t2': '#3f4949', '--t3': '#6f7979',
      '--cyan': '#006a6a', '--green': '#2f6a4f', '--purple': '#5b6b8a', '--pink': '#8b5a6a', '--orange': '#8b6a3c', '--yellow': '#8a7a2f',
    },
    dark: {
      '--c0': '#0e1414', '--c1': '#191c1c', '--c2': '#222828', '--c3': '#2d3535', '--c4': '#3d4848', '--c5': '#516060',
      '--m3-primary': '#4cdad9', '--m3-on-primary': '#003737',
      '--m3-primary-container': '#004f4f', '--m3-on-primary-container': '#6ff7f6',
      '--m3-secondary': '#b0cccb', '--m3-secondary-container': '#334b4b',
      '--m3-tertiary': '#b3c8e8', '--m3-tertiary-container': '#334863',
      '--m3-surface': '#191c1c', '--m3-surface-low': '#0e1414', '--m3-tonal': '#004f4f', '--m3-outline': '#3d4848',
      '--t1': '#e0e3e2', '--t2': '#c0c8c7', '--t3': '#899392',
      '--cyan': '#4cdad9', '--green': '#8fd5a8', '--purple': '#b3c8e8', '--pink': '#e0b0c0', '--orange': '#e0c090', '--yellow': '#d8d080',
    },
  },
  plum: {
    label: 'Plum',
    swatch: '#7b2d5e',
    light: {
      '--c0': '#fff0f6', '--c1': '#fff7fa', '--c2': '#ffffff', '--c3': '#ffd8e8', '--c4': '#f5b8d4', '--c5': '#e090b8',
      '--m3-primary': '#7b2d5e', '--m3-on-primary': '#ffffff',
      '--m3-primary-container': '#ffd8e8', '--m3-on-primary-container': '#31001f',
      '--m3-secondary': '#8e4a6e', '--m3-secondary-container': '#ffd9e8',
      '--m3-tertiary': '#6b4a8a', '--m3-tertiary-container': '#efdbff',
      '--m3-surface': '#fff7fa', '--m3-surface-low': '#fff0f6', '--m3-tonal': '#ffd8e8', '--m3-outline': '#f5b8d4',
      '--t1': '#201a1d', '--t2': '#524048', '--t3': '#857078',
      '--cyan': '#7b2d5e', '--green': '#4a7c59', '--purple': '#6b4a8a', '--pink': '#c45c7a', '--orange': '#c9784a', '--yellow': '#b89a3d',
    },
    dark: {
      '--c0': '#180f14', '--c1': '#201a1d', '--c2': '#2c2228', '--c3': '#3b2d35', '--c4': '#4e3c46', '--c5': '#64505a',
      '--m3-primary': '#ffb0d0', '--m3-on-primary': '#4e0032',
      '--m3-primary-container': '#621447', '--m3-on-primary-container': '#ffd8e8',
      '--m3-secondary': '#ffb1cb', '--m3-secondary-container': '#723352',
      '--m3-tertiary': '#d6b9f0', '--m3-tertiary-container': '#52326a',
      '--m3-surface': '#201a1d', '--m3-surface-low': '#180f14', '--m3-tonal': '#621447', '--m3-outline': '#4e3c46',
      '--t1': '#ece0e5', '--t2': '#d0c3c8', '--t3': '#a08c94',
      '--cyan': '#ffb0d0', '--green': '#a8d5b3', '--purple': '#d6b9f0', '--pink': '#ffb1cb', '--orange': '#ffb68a', '--yellow': '#e8c872',
    },
  },
  sand: {
    label: 'Sand',
    swatch: '#7c5e30',
    light: {
      '--c0': '#faf6ef', '--c1': '#fffaf0', '--c2': '#ffffff', '--c3': '#f0e2c8', '--c4': '#e0cba0', '--c5': '#c9ad74',
      '--m3-primary': '#7c5e30', '--m3-on-primary': '#ffffff',
      '--m3-primary-container': '#ffdfa0', '--m3-on-primary-container': '#291800',
      '--m3-secondary': '#6d5e40', '--m3-secondary-container': '#f6e2bc',
      '--m3-tertiary': '#4d6544', '--m3-tertiary-container': '#cfeac0',
      '--m3-surface': '#fffaf0', '--m3-surface-low': '#faf6ef', '--m3-tonal': '#ffdfa0', '--m3-outline': '#e0cba0',
      '--t1': '#1f1b13', '--t2': '#4f4636', '--t3': '#7d7464',
      '--cyan': '#7c5e30', '--green': '#4d6544', '--purple': '#6b5b7a', '--pink': '#8b5a5a', '--orange': '#9a6a30', '--yellow': '#b89a3d',
    },
    dark: {
      '--c0': '#14110c', '--c1': '#1f1b13', '--c2': '#2a241a', '--c3': '#383022', '--c4': '#4a4030', '--c5': '#605440',
      '--m3-primary': '#efc06c', '--m3-on-primary': '#432c00',
      '--m3-primary-container': '#5f440f', '--m3-on-primary-container': '#ffdfa0',
      '--m3-secondary': '#d9c6a1', '--m3-secondary-container': '#54462a',
      '--m3-tertiary': '#b3cea5', '--m3-tertiary-container': '#364d2e',
      '--m3-surface': '#1f1b13', '--m3-surface-low': '#14110c', '--m3-tonal': '#5f440f', '--m3-outline': '#4a4030',
      '--t1': '#ebe1d4', '--t2': '#cfc4b4', '--t3': '#9a8f7e',
      '--cyan': '#efc06c', '--green': '#b3cea5', '--purple': '#c8b8d8', '--pink': '#e0b0b0', '--orange': '#ffb68a', '--yellow': '#e8c872',
    },
  },
  coral: {
    label: 'Coral',
    swatch: '#b13d3a',
    light: {
      '--c0': '#fff5f3', '--c1': '#fff8f7', '--c2': '#ffffff', '--c3': '#ffdad6', '--c4': '#ffb3ab', '--c5': '#f28f86',
      '--m3-primary': '#b13d3a', '--m3-on-primary': '#ffffff',
      '--m3-primary-container': '#ffdad6', '--m3-on-primary-container': '#410002',
      '--m3-secondary': '#c45c4a', '--m3-secondary-container': '#ffdad2',
      '--m3-tertiary': '#6b5b2e', '--m3-tertiary-container': '#f4e0a6',
      '--m3-surface': '#fff8f7', '--m3-surface-low': '#fff5f3', '--m3-tonal': '#ffdad6', '--m3-outline': '#ffb3ab',
      '--t1': '#201a19', '--t2': '#534341', '--t3': '#857370',
      '--cyan': '#b13d3a', '--green': '#4a7c59', '--purple': '#7d5260', '--pink': '#c45c7a', '--orange': '#c9784a', '--yellow': '#b89a3d',
    },
    dark: {
      '--c0': '#1a1110', '--c1': '#201a19', '--c2': '#2c2221', '--c3': '#3b2c2a', '--c4': '#4e3b39', '--c5': '#634e4b',
      '--m3-primary': '#ffb4ab', '--m3-on-primary': '#690005',
      '--m3-primary-container': '#8f2322', '--m3-on-primary-container': '#ffdad6',
      '--m3-secondary': '#ffb4a4', '--m3-secondary-container': '#8c3a2c',
      '--m3-tertiary': '#d7c48c', '--m3-tertiary-container': '#524419',
      '--m3-surface': '#201a19', '--m3-surface-low': '#1a1110', '--m3-tonal': '#8f2322', '--m3-outline': '#4e3b39',
      '--t1': '#ece0de', '--t2': '#d0c3c1', '--t3': '#a08c89',
      '--cyan': '#ffb4ab', '--green': '#a8d5b3', '--purple': '#efb8c8', '--pink': '#ffb1c5', '--orange': '#ffb68a', '--yellow': '#e8c872',
    },
  },
  indigo: {
    label: 'Indigo',
    swatch: '#4355b9',
    light: {
      '--c0': '#f2f3fc', '--c1': '#f8f8ff', '--c2': '#ffffff', '--c3': '#e0e1fd', '--c4': '#c2c4f8', '--c5': '#a0a3ef',
      '--m3-primary': '#4355b9', '--m3-on-primary': '#ffffff',
      '--m3-primary-container': '#dee0ff', '--m3-on-primary-container': '#000e5e',
      '--m3-secondary': '#5a5d72', '--m3-secondary-container': '#dfe1f9',
      '--m3-tertiary': '#75546f', '--m3-tertiary-container': '#ffd7f5',
      '--m3-surface': '#f8f8ff', '--m3-surface-low': '#f2f3fc', '--m3-tonal': '#dee0ff', '--m3-outline': '#c2c4f8',
      '--t1': '#1a1b23', '--t2': '#45464f', '--t3': '#767680',
      '--cyan': '#4355b9', '--green': '#3d6b4f', '--purple': '#5c4d9a', '--pink': '#75546f', '--orange': '#9a6540', '--yellow': '#9a8430',
    },
    dark: {
      '--c0': '#11121a', '--c1': '#1a1b23', '--c2': '#252632', '--c3': '#313240', '--c4': '#424354', '--c5': '#56576c',
      '--m3-primary': '#bac3ff', '--m3-on-primary': '#13278a',
      '--m3-primary-container': '#2a3c9f', '--m3-on-primary-container': '#dee0ff',
      '--m3-secondary': '#c3c5dd', '--m3-secondary-container': '#424659',
      '--m3-tertiary': '#e3bada', '--m3-tertiary-container': '#5c3d59',
      '--m3-surface': '#1a1b23', '--m3-surface-low': '#11121a', '--m3-tonal': '#2a3c9f', '--m3-outline': '#424354',
      '--t1': '#e3e1ec', '--t2': '#c6c5d0', '--t3': '#90909a',
      '--cyan': '#bac3ff', '--green': '#a8d5b3', '--purple': '#c9b6ff', '--pink': '#e3bada', '--orange': '#ffb68a', '--yellow': '#e8c872',
    },
  },
  mint: {
    label: 'Mint',
    swatch: '#006c51',
    light: {
      '--c0': '#eef8f3', '--c1': '#f4fbf7', '--c2': '#ffffff', '--c3': '#d0ebe0', '--c4': '#a8d9c4', '--c5': '#7ec4a8',
      '--m3-primary': '#006c51', '--m3-on-primary': '#ffffff',
      '--m3-primary-container': '#89f8d0', '--m3-on-primary-container': '#002116',
      '--m3-secondary': '#4c6359', '--m3-secondary-container': '#cee9db',
      '--m3-tertiary': '#3f6374', '--m3-tertiary-container': '#c2e8f7',
      '--m3-surface': '#f4fbf7', '--m3-surface-low': '#eef8f3', '--m3-tonal': '#89f8d0', '--m3-outline': '#a8d9c4',
      '--t1': '#171d1a', '--t2': '#3f4944', '--t3': '#6f7973',
      '--cyan': '#006c51', '--green': '#2f8a60', '--purple': '#5b6b7a', '--pink': '#8b5a6a', '--orange': '#8b6a3c', '--yellow': '#8a7a2f',
    },
    dark: {
      '--c0': '#0c1410', '--c1': '#171d1a', '--c2': '#212925', '--c3': '#2c3530', '--c4': '#3c4741', '--c5': '#4f5d55',
      '--m3-primary': '#6cdbb4', '--m3-on-primary': '#003828',
      '--m3-primary-container': '#00513c', '--m3-on-primary-container': '#89f8d0',
      '--m3-secondary': '#b3ccc0', '--m3-secondary-container': '#354b42',
      '--m3-tertiary': '#a6cdda', '--m3-tertiary-container': '#264b5b',
      '--m3-surface': '#171d1a', '--m3-surface-low': '#0c1410', '--m3-tonal': '#00513c', '--m3-outline': '#3c4741',
      '--t1': '#dde4df', '--t2': '#c0c9c3', '--t3': '#8a938d',
      '--cyan': '#6cdbb4', '--green': '#8fd5a8', '--purple': '#b3c8e8', '--pink': '#e0b0c0', '--orange': '#e0c090', '--yellow': '#d8d080',
    },
  },
  amber: {
    label: 'Amber',
    swatch: '#7c5800',
    light: {
      '--c0': '#fff8eb', '--c1': '#fffcf4', '--c2': '#ffffff', '--c3': '#ffe7b0', '--c4': '#ffd270', '--c5': '#efb83a',
      '--m3-primary': '#7c5800', '--m3-on-primary': '#ffffff',
      '--m3-primary-container': '#ffdf9a', '--m3-on-primary-container': '#271900',
      '--m3-secondary': '#6b5d3f', '--m3-secondary-container': '#f4e1bb',
      '--m3-tertiary': '#4c6545', '--m3-tertiary-container': '#ceeac3',
      '--m3-surface': '#fffcf4', '--m3-surface-low': '#fff8eb', '--m3-tonal': '#ffdf9a', '--m3-outline': '#ffd270',
      '--t1': '#1f1b10', '--t2': '#4f4632', '--t3': '#7d7460',
      '--cyan': '#7c5800', '--green': '#4c6545', '--purple': '#6b5b7a', '--pink': '#8b5a5a', '--orange': '#9a6a20', '--yellow': '#b89a20',
    },
    dark: {
      '--c0': '#151208', '--c1': '#1f1b10', '--c2': '#2a2416', '--c3': '#38301e', '--c4': '#4a402a', '--c5': '#605438',
      '--m3-primary': '#f7bd48', '--m3-on-primary': '#412d00',
      '--m3-primary-container': '#5e4200', '--m3-on-primary-container': '#ffdf9a',
      '--m3-secondary': '#d7c5a0', '--m3-secondary-container': '#52462a',
      '--m3-tertiary': '#b2cea8', '--m3-tertiary-container': '#354d2f',
      '--m3-surface': '#1f1b10', '--m3-surface-low': '#151208', '--m3-tonal': '#5e4200', '--m3-outline': '#4a402a',
      '--t1': '#ebe1d0', '--t2': '#cfc4b0', '--t3': '#9a8f7a',
      '--cyan': '#f7bd48', '--green': '#b2cea8', '--purple': '#c8b8d8', '--pink': '#e0b0b0', '--orange': '#ffb68a', '--yellow': '#e8c872',
    },
  },
  slate: {
    label: 'Slate',
    swatch: '#4a5c6a',
    light: {
      '--c0': '#f2f5f7', '--c1': '#f7fafc', '--c2': '#ffffff', '--c3': '#e2e8ed', '--c4': '#c5d0d8', '--c5': '#a3b2be',
      '--m3-primary': '#4a5c6a', '--m3-on-primary': '#ffffff',
      '--m3-primary-container': '#cde6f7', '--m3-on-primary-container': '#061e2b',
      '--m3-secondary': '#55606a', '--m3-secondary-container': '#d8e3ed',
      '--m3-tertiary': '#65597a', '--m3-tertiary-container': '#eaddff',
      '--m3-surface': '#f7fafc', '--m3-surface-low': '#f2f5f7', '--m3-tonal': '#cde6f7', '--m3-outline': '#c5d0d8',
      '--t1': '#181c1f', '--t2': '#41484d', '--t3': '#71787e',
      '--cyan': '#4a5c6a', '--green': '#3d6b4f', '--purple': '#65597a', '--pink': '#7a5568', '--orange': '#8b6a3c', '--yellow': '#8a7a2f',
    },
    dark: {
      '--c0': '#0f1214', '--c1': '#181c1f', '--c2': '#22272b', '--c3': '#2e3439', '--c4': '#3e464c', '--c5': '#525b63',
      '--m3-primary': '#b1cadb', '--m3-on-primary': '#1d3340',
      '--m3-primary-container': '#344a57', '--m3-on-primary-container': '#cde6f7',
      '--m3-secondary': '#bcc7d1', '--m3-secondary-container': '#3e4952',
      '--m3-tertiary': '#cec0e8', '--m3-tertiary-container': '#4d4161',
      '--m3-surface': '#181c1f', '--m3-surface-low': '#0f1214', '--m3-tonal': '#344a57', '--m3-outline': '#3e464c',
      '--t1': '#e0e3e6', '--t2': '#c0c7cc', '--t3': '#8a9298',
      '--cyan': '#b1cadb', '--green': '#a8d5b3', '--purple': '#cec0e8', '--pink': '#e0b0c0', '--orange': '#e0c090', '--yellow': '#d8d080',
    },
  },
  fuchsia: {
    label: 'Fuchsia',
    swatch: '#9c27b0',
    light: {
      '--c0': '#fbf0fb', '--c1': '#fff5ff', '--c2': '#ffffff', '--c3': '#f5d6f7', '--c4': '#e8b0ec', '--c5': '#d48adb',
      '--m3-primary': '#9c27b0', '--m3-on-primary': '#ffffff',
      '--m3-primary-container': '#f9d8ff', '--m3-on-primary-container': '#36003e',
      '--m3-secondary': '#6e586e', '--m3-secondary-container': '#f7daf7',
      '--m3-tertiary': '#82524a', '--m3-tertiary-container': '#ffdad3',
      '--m3-surface': '#fff5ff', '--m3-surface-low': '#fbf0fb', '--m3-tonal': '#f9d8ff', '--m3-outline': '#e8b0ec',
      '--t1': '#1e1a1e', '--t2': '#4e444e', '--t3': '#7e727e',
      '--cyan': '#9c27b0', '--green': '#4a7c59', '--purple': '#7c4dff', '--pink': '#c45c9a', '--orange': '#c9784a', '--yellow': '#b89a3d',
    },
    dark: {
      '--c0': '#160f16', '--c1': '#1e1a1e', '--c2': '#2a232a', '--c3': '#392f39', '--c4': '#4c404c', '--c5': '#625462',
      '--m3-primary': '#f0aaff', '--m3-on-primary': '#560a63',
      '--m3-primary-container': '#711988', '--m3-on-primary-container': '#f9d8ff',
      '--m3-secondary': '#dabfd9', '--m3-secondary-container': '#554055',
      '--m3-tertiary': '#f5b8ad', '--m3-tertiary-container': '#663b34',
      '--m3-surface': '#1e1a1e', '--m3-surface-low': '#160f16', '--m3-tonal': '#711988', '--m3-outline': '#4c404c',
      '--t1': '#ece0ec', '--t2': '#d0c3d0', '--t3': '#a08ca0',
      '--cyan': '#f0aaff', '--green': '#a8d5b3', '--purple': '#d0bcff', '--pink': '#ffb1d8', '--orange': '#ffb68a', '--yellow': '#e8c872',
    },
  },
  ocean: {
    label: 'Ocean',
    swatch: '#005f73',
    light: {
      '--c0': '#eef7f9', '--c1': '#f3fafc', '--c2': '#ffffff', '--c3': '#cfe8ee', '--c4': '#a0d0db', '--c5': '#6fb5c4',
      '--m3-primary': '#005f73', '--m3-on-primary': '#ffffff',
      '--m3-primary-container': '#97f0ff', '--m3-on-primary-container': '#001f25',
      '--m3-secondary': '#4a6268', '--m3-secondary-container': '#cde7ed',
      '--m3-tertiary': '#525e7d', '--m3-tertiary-container': '#dae2ff',
      '--m3-surface': '#f3fafc', '--m3-surface-low': '#eef7f9', '--m3-tonal': '#97f0ff', '--m3-outline': '#a0d0db',
      '--t1': '#161d1f', '--t2': '#3f484b', '--t3': '#6f787b',
      '--cyan': '#005f73', '--green': '#2f6a4f', '--purple': '#525e7d', '--pink': '#8b5a6a', '--orange': '#8b6a3c', '--yellow': '#8a7a2f',
    },
    dark: {
      '--c0': '#0c1315', '--c1': '#161d1f', '--c2': '#20282a', '--c3': '#2b3437', '--c4': '#3b4649', '--c5': '#4e5b5f',
      '--m3-primary': '#4fd8eb', '--m3-on-primary': '#00363e',
      '--m3-primary-container': '#004e59', '--m3-on-primary-container': '#97f0ff',
      '--m3-secondary': '#b1cbd1', '--m3-secondary-container': '#334a50',
      '--m3-tertiary': '#bac6ea', '--m3-tertiary-container': '#3b4664',
      '--m3-surface': '#161d1f', '--m3-surface-low': '#0c1315', '--m3-tonal': '#004e59', '--m3-outline': '#3b4649',
      '--t1': '#dde4e6', '--t2': '#c0c8cb', '--t3': '#899397',
      '--cyan': '#4fd8eb', '--green': '#8fd5a8', '--purple': '#bac6ea', '--pink': '#e0b0c0', '--orange': '#e0c090', '--yellow': '#d8d080',
    },
  },
};

export const THEMES = Object.fromEntries(
  Object.entries(SEEDS).map(([id, s]) => [id, { label: s.label, swatch: s.swatch || null }])
);

export function themeList() {
  return Object.entries(SEEDS).map(([id, s]) => ({
    id,
    label: s.label,
    swatch: s.swatch || 'linear-gradient(135deg,#6750a4,#c45c7a,#4a7c59)',
  }));
}

function resolveMode(mode) {
  if (mode === 'dark') return 'dark';
  if (mode === 'light') return 'light';
  // system
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

/** Apply Material You theme with optional animated crossfade.
 *  visualSkin: 'material' | 'editorial' | 'minimal' — locked skins replace seed colors.
 *  editorialCombo: curated 2-color pair when visualSkin === 'editorial'
 */
export function applyTheme(
  themeId = 'auto',
  mode = 'auto',
  root = document.documentElement,
  { animate = true, visualSkin = 'material', editorialCombo = 'cream-teal' } = {}
) {
  const id = themeId in SEEDS ? themeId : 'auto';
  const tone = resolveMode(mode);
  const visual = normalizeVisualTheme(visualSkin);
  const locked = paletteForVisual(visual, tone, editorialCombo);
  const vars = locked || SEEDS[id][tone];

  if (animate) {
    root.classList.add('theme-switching');
  }

  root.setAttribute('data-theme', id);
  root.setAttribute('data-mode', tone);
  root.setAttribute('data-m3', 'expressive');
  root.setAttribute('data-visual', visual);
  if (visual === 'editorial') {
    root.setAttribute('data-editorial-combo', editorialCombo || 'cream-teal');
  } else {
    root.removeAttribute('data-editorial-combo');
  }

  for (const [k, v] of Object.entries(vars)) {
    root.style.setProperty(k, v);
  }

  // Skin tokens (elevation, fonts, chart knobs)
  applyVisualSkin(visual, tone, root);
  setIconPack(visual);

  if (animate) {
    requestAnimationFrame(() => {
      setTimeout(() => root.classList.remove('theme-switching'), 420);
    });
  }
  return { theme: id, mode: tone, visual, editorialCombo };
}

/** Convenience: paint from settings object */
export function applySettingsTheme(settings = {}, root = document.documentElement, opts = {}) {
  return applyTheme(
    settings.theme || 'auto',
    settings.themeMode || 'auto',
    root,
    {
      ...opts,
      visualSkin: settings.visualTheme || 'material',
      editorialCombo: settings.editorialCombo || 'cream-teal',
    }
  );
}

export function toggleTheme(current) {
  const order = ['auto', 'violet', 'rose', 'sage', 'ember', 'teal', 'plum', 'sand', 'coral', 'indigo', 'mint', 'amber', 'slate', 'fuchsia', 'ocean'];
  const i = order.indexOf(current);
  return order[(i + 1) % order.length];
}

export function isLightTheme(_themeId, mode = 'auto') {
  return resolveMode(mode) === 'light';
}
