// Starter lesson: charging a capacitor through a resistor.
import { makeObject } from './components.js';

export function demoProject() {
  const o = (type, id, extra) => ({ ...makeObject(type, extra), id });
  const title = o('text', 'title', { text: 'RC Circuits', size: 72, y: 0.6, color: '#58c4dd' });
  const sub = o('text', 'sub', { text: 'How a capacitor charges', size: 36, y: -0.6, enter: 'FadeIn', step: 2 });

  const comp = { color: '#ffffff', step: 1 };
  const circuit = [
    o('battery', 'bat', { ...comp, x: -5, y: 0, rot: 270, label: 'V' }),
    o('wire', 'w1', { ...comp, x: -5, y: 1, dx: 0.5, dy: 1, route: 'vh' }),
    o('switch', 'sw', { ...comp, x: -3.5, y: 2, label: 'S' }),
    o('resistor', 'res', { ...comp, x: -1.5, y: 2, label: 'R' }),
    o('wire', 'w2', { ...comp, x: -0.5, y: 2, dx: 0.5, dy: -1, route: 'hv' }),
    o('capacitor', 'cap', { ...comp, x: 0, y: 0, rot: 90, label: 'C', color: '#58c4dd' }),
    o('wire', 'w3', { ...comp, x: 0, y: -1, dx: -5, dy: 0, route: 'straight' }),
  ];

  const s1 = { id: 's1', name: 'Title', notes: 'Introduce the topic.', objects: [title, sub] };
  const s2 = {
    id: 's2', name: 'The circuit', notes: 'Walk through each part. The switch is open, so no current flows.',
    objects: [{ ...title, text: 'The circuit', size: 40, x: 0, y: 3.3, color: '#ffffff' }, ...circuit],
  };
  const closed = circuit.map((c) => {
    if (c.id === 'sw') return { ...c, closed: true, color: '#83c167' };
    if (c.type === 'wire') return { ...c, emph: 'FlowCurrent' };
    return c;
  });
  const graph = o('axes', 'graph', { x: 4.2, y: -0.2, w: 4.5, h: 3, xmin: 0, xmax: 5, xstep: 1, ymin: 0, ymax: 1.2, ystep: 0.2, fx: '1-exp(-x)', gcolor: '#58c4dd', step: 2 });
  const xl = o('text', 'xl', { text: 't / RC', size: 24, x: 6.1, y: -2.1, step: 2, enter: 'FadeIn' });
  const yl = o('text', 'yl', { text: 'Vc / V', size: 24, x: 2.1, y: 1.65, step: 2, enter: 'FadeIn' });
  const formula = o('text', 'eq', { text: 'Vc(t) = V · (1 − e^(−t/RC))', size: 26, x: 4.2, y: 2.4, color: '#ffff00', step: 3, enter: 'Write' });
  const s3 = {
    id: 's3', name: 'Close the switch', notes: 'Current flows, the capacitor voltage rises and levels off at V.',
    objects: [{ ...s2.objects[0], text: 'Close the switch' }, ...closed, graph, xl, yl, formula],
  };
  return { title: 'RC Circuit', bg: '#0e1116', font: 'Atkinson Hyperlegible', version: 1, slides: [s1, s2, s3] };
}
