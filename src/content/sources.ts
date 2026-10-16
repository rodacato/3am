// Bibliographic facts stay as published; what each source teaches is paraphrased per locale (source.<id>.note).
export type Source = { id: string; title: string; authors: string; year: number; url: string };

export const SOURCES: readonly Source[] = [
  { id: 'sre-book-postmortems', title: 'Site Reliability Engineering, ch. 15: Postmortem Culture', authors: 'Beyer, Jones, Petoff, Murphy (eds.)', year: 2016, url: 'https://sre.google/sre-book/postmortem-culture/' },
  { id: 'sre-book-incident', title: 'Site Reliability Engineering, ch. 14: Managing Incidents', authors: 'Beyer, Jones, Petoff, Murphy (eds.)', year: 2016, url: 'https://sre.google/sre-book/managing-incidents/' },
  { id: 'sre-workbook-incident', title: 'The Site Reliability Workbook, ch. 9: Incident Response', authors: 'Beyer, Murphy, Rensin, Kawahara, Thorne (eds.)', year: 2018, url: 'https://sre.google/workbook/incident-response/' },
  { id: 'red-method', title: 'The RED Method: How to Instrument Your Services', authors: 'Tom Wilkie', year: 2018, url: 'https://grafana.com/blog/2018/08/02/the-red-method-how-to-instrument-your-services/' },
  { id: 'use-method', title: 'The USE Method', authors: 'Brendan Gregg', year: 2012, url: 'https://www.brendangregg.com/usemethod.html' },
  { id: 'observability-engineering', title: 'Observability Engineering', authors: 'Charity Majors, Liz Fong-Jones, George Miranda', year: 2022, url: 'https://www.oreilly.com/library/view/observability-engineering/9781492076438/' },
  { id: 'field-guide-human-error', title: 'The Field Guide to Understanding Human Error', authors: 'Sidney Dekker', year: 2014, url: 'https://www.routledge.com/The-Field-Guide-to-Understanding-Human-Error/Dekker/p/book/9781472439055' },
  { id: 'how-complex-systems-fail', title: 'How Complex Systems Fail', authors: 'Richard I. Cook', year: 1998, url: 'https://how.complexsystems.fail/' },
];
