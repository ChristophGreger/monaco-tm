import { getSemanticHover } from './index';

const hoverProgram = `tapes: 1
blank: _
alphabet: {0, " ", _}
input: ""
start: q0

state q0:
  on 0 -> move S; goto missing;
`;

describe('getSemanticHover', () => {
  it('describes header keywords', () => {
    expect(getSemanticHover(hoverProgram, 1, 2)).toContain(
      'Declares how many tapes',
    );
  });

  it('describes the relaxed input header semantics', () => {
    expect(getSemanticHover(hoverProgram, 4, 2)).toContain(
      'Missing tape segments are filled',
    );
  });

  it('describes declared states', () => {
    expect(getSemanticHover(hoverProgram, 7, 8)).toBe(
      'State `q0` declares 1 transition(s).',
    );
  });

  it('describes missing goto targets', () => {
    expect(getSemanticHover(hoverProgram, 8, 27)).toBe(
      'Goto target `missing` is not declared.',
    );
  });

  it('describes tape symbols from the alphabet', () => {
    expect(getSemanticHover(hoverProgram, 8, 6)).toBe(
      'Tape symbol `0` from the alphabet.',
    );
  });

  it('describes quoted text', () => {
    expect(getSemanticHover(hoverProgram, 3, 15)).toBe(
      'Quoted text is used for input segments and one-character symbols such as spaces.',
    );
  });

  it('describes tape references', () => {
    const program = `${hoverProgram}
state q1:
  if t1 = _ then move S; goto q0;
`;

    expect(getSemanticHover(program, 11, 6)).toBe(
      'Tape reference `t1`. Tape indexes start at 1.',
    );
  });
});
