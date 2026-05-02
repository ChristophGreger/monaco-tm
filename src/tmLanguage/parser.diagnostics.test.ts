import { expectDiagnosticCodes } from './testUtils';

describe('parseTuringMachine diagnostics', () => {
  it('reports unknown characters', () => {
    expectDiagnosticCodes('@', ['LEX_UNKNOWN_CHARACTER']);
  });

  it('reports strings that reach a line break', () => {
    expectDiagnosticCodes(`tapes 1
blank _
alphabet {0, _}
input "0
start q0
`, ['LEX_UNTERMINATED_STRING']);
  });

  it('reports strings that reach the end of file', () => {
    expectDiagnosticCodes(`tapes 1
blank _
alphabet {0, _}
input "0`, ['LEX_UNTERMINATED_STRING']);
  });

  it('reports unterminated block comments', () => {
    expectDiagnosticCodes(`tapes 1
/* open comment`, ['LEX_UNTERMINATED_BLOCK_COMMENT']);
  });

  it('reports unexpected top-level content', () => {
    expectDiagnosticCodes('move R;', ['PARSE_EXPECTED_TOP_LEVEL']);
  });

  it('reports duplicate headers', () => {
    expectDiagnosticCodes(`tapes 1
tapes 2
blank _
alphabet {0, _}
input ""
start q0

state q0:
  halt
`, ['PARSE_DUPLICATE_HEADER']);
  });

  it('reports trailing header tokens', () => {
    expectDiagnosticCodes(`tapes 1 extra
blank _
alphabet {0, _}
input ""
start q0

state q0:
  halt
`, ['PARSE_TRAILING_HEADER_TOKENS']);
  });

  it('reports missing required headers', () => {
    expectDiagnosticCodes(`state q0:
  halt
`, [
      'VALIDATION_MISSING_HEADER',
    ]);
  });

  it('reports tape counts outside the supported range', () => {
    expectDiagnosticCodes(`tapes 7
blank _
alphabet {0, _}
input ""
start q0

state q0:
  halt
`, ['VALIDATION_TAPES_RANGE']);
  });

  it('reports blank symbols outside the alphabet', () => {
    expectDiagnosticCodes(`tapes 1
blank _
alphabet {0, 1}
input "0"
start q0

state q0:
  halt
`, ['VALIDATION_BLANK_NOT_IN_ALPHABET']);
  });

  it('reports duplicate alphabet symbols', () => {
    expectDiagnosticCodes(`tapes 1
blank _
alphabet {0, 0, _}
input "0"
start q0

state q0:
  halt
`, ['VALIDATION_DUPLICATE_ALPHABET_SYMBOL']);
  });

  it('reports too many input segments', () => {
    expectDiagnosticCodes(`tapes 2
blank _
alphabet {0, 1, _}
input "10" | "" | ""
start q0

state q0:
  halt
`, ['VALIDATION_INPUT_TAPE_COUNT']);
  });

  it('reports input symbols outside the alphabet', () => {
    expectDiagnosticCodes(`tapes 1
blank _
alphabet {0, _}
input "1"
start q0

state q0:
  halt
`, ['VALIDATION_INPUT_SYMBOL']);
  });

  it('reports unknown start states', () => {
    expectDiagnosticCodes(`tapes 1
blank _
alphabet {0, _}
input ""
start missing

state q0:
  halt
`, ['VALIDATION_UNKNOWN_START_STATE']);
  });

  it('reports duplicate states', () => {
    expectDiagnosticCodes(`tapes 1
blank _
alphabet {0, _}
input ""
start q0

state q0:
  halt

state q0:
  halt
`, ['VALIDATION_DUPLICATE_STATE']);
  });

  it('reports halt states that also contain transitions', () => {
    expectDiagnosticCodes(`tapes 1
blank _
alphabet {_, 0}
input ""
start q0

state q0:
  halt
  on _ -> move S;
`, ['VALIDATION_HALT_HAS_TRANSITIONS']);
  });

  it('reports duplicate halt declarations', () => {
    expectDiagnosticCodes(`tapes 1
blank _
alphabet {_, 0}
input ""
start q0

state q0:
  halt
  halt
`, ['PARSE_DUPLICATE_HALT']);
  });

  it('reports trailing tokens after halt', () => {
    expectDiagnosticCodes(`tapes 1
blank _
alphabet {_, 0}
input ""
start q0

state q0:
  halt now
`, ['PARSE_TRAILING_RULE_TOKENS']);
  });

  it('reports unknown rules inside a state', () => {
    expectDiagnosticCodes(`tapes 1
blank _
alphabet {_, 0}
input ""
start q0

state q0:
  write 0; move S;
`, ['PARSE_EXPECTED_RULE']);
  });

  it('reports missing arrows in compact transitions', () => {
    expectDiagnosticCodes(`tapes 1
blank _
alphabet {_, 0}
input ""
start q0

state q0:
  on _ move S;
`, ['PARSE_UNEXPECTED_TOKEN']);
  });

  it('reports missing then in readable transitions', () => {
    expectDiagnosticCodes(`tapes 1
blank _
alphabet {_, 0}
input ""
start q0

state q0:
  if t1 = _ move S;
`, ['PARSE_UNEXPECTED_TOKEN']);
  });

  it('reports invalid condition starts', () => {
    expectDiagnosticCodes(`tapes 1
blank _
alphabet {_, 0}
input ""
start q0

state q0:
  if _ = t1 then move S;
`, ['PARSE_EXPECTED_TAPE_REFERENCE']);
  });

  it('reports invalid condition operators', () => {
    expectDiagnosticCodes(`tapes 1
blank _
alphabet {_, 0}
input ""
start q0

state q0:
  if t1 _ then move S;
`, ['PARSE_EXPECTED_CONDITION_OPERATOR']);
  });

  it('reports unclosed symbol sets', () => {
    expectDiagnosticCodes(`tapes 1
blank _
alphabet {_, 0}
input ""
start q0

state q0:
  if t1 in {_,0 then move S;
`, ['PARSE_UNEXPECTED_TOKEN']);
  });

  it('reports choose blocks without an opening brace', () => {
    expectDiagnosticCodes(`tapes 1
blank _
alphabet {_, 0}
input ""
start q0

state q0:
  on _ -> choose
    move S;
`, ['PARSE_UNEXPECTED_TOKEN']);
  });

  it('reports choose blocks without a closing brace', () => {
    expectDiagnosticCodes(`tapes 1
blank _
alphabet {_, 0}
input ""
start q0

state q0:
  on _ -> choose {
    move S;
`, ['PARSE_UNEXPECTED_TOKEN']);
  });

  it('reports missing action semicolons', () => {
    expectDiagnosticCodes(`tapes 1
blank _
alphabet {_, 0}
input ""
start q0

state q0:
  on _ -> move S
`, ['PARSE_UNEXPECTED_TOKEN']);
  });

  it('reports unknown action statements', () => {
    expectDiagnosticCodes(`tapes 1
blank _
alphabet {_, 0}
input ""
start q0

state q0:
  on _ -> erase _; move S;
`, ['PARSE_EXPECTED_ACTION']);
  });

  it('reports duplicate write actions', () => {
    expectDiagnosticCodes(`tapes 1
blank _
alphabet {_, 0}
input ""
start q0

state q0:
  on _ -> write 0; write _; move S;
`, ['PARSE_DUPLICATE_WRITE']);
  });

  it('reports duplicate move actions', () => {
    expectDiagnosticCodes(`tapes 1
blank _
alphabet {_, 0}
input ""
start q0

state q0:
  on _ -> move S; move R;
`, ['PARSE_DUPLICATE_MOVE']);
  });

  it('reports duplicate goto actions', () => {
    expectDiagnosticCodes(`tapes 1
blank _
alphabet {_, 0}
input ""
start q0

state q0:
  on _ -> move S; goto q0; goto q0;
`, ['PARSE_DUPLICATE_GOTO']);
  });

  it('reports invalid move directions', () => {
    expectDiagnosticCodes(`tapes 1
blank _
alphabet {_, 0}
input ""
start q0

state q0:
  on _ -> move X;
`, ['PARSE_INVALID_DIRECTION']);
  });

  it('reports unquoted reserved symbols', () => {
    expectDiagnosticCodes(`tapes 1
blank _
alphabet {same, _}
input ""
start q0

state q0:
  on _ -> move S;
`, ['PARSE_RESERVED_SYMBOL']);
  });

  it('reports reserved state names', () => {
    expectDiagnosticCodes(`tapes 1
blank _
alphabet {_, 0}
input ""
start state

state state:
  halt
`, ['PARSE_RESERVED_STATE_NAME']);
  });

  it('reports invalid state names', () => {
    expectDiagnosticCodes(`tapes 1
blank _
alphabet {_, 0}
input ""
start q0

state 1:
  halt
`, ['PARSE_EXPECTED_STATE_NAME']);
  });

  it('reports read pattern arity mismatches', () => {
    expectDiagnosticCodes(`tapes 2
blank _
alphabet {_, 0}
input ""
start q0

state q0:
  on _ -> move S/S;
`, ['VALIDATION_READ_PATTERN_ARITY']);
  });

  it('reports write pattern arity mismatches', () => {
    expectDiagnosticCodes(`tapes 2
blank _
alphabet {_, 0}
input ""
start q0

state q0:
  on _/_ -> write 0; move S/S;
`, ['VALIDATION_WRITE_PATTERN_ARITY']);
  });

  it('reports move pattern arity mismatches', () => {
    expectDiagnosticCodes(`tapes 2
blank _
alphabet {_, 0}
input ""
start q0

state q0:
  on _/_ -> move S;
`, ['VALIDATION_MOVE_PATTERN_ARITY']);
  });

  it('reports missing move actions', () => {
    expectDiagnosticCodes(`tapes 1
blank _
alphabet {_, 0}
input ""
start q0

state q0:
  on _ -> write 0;
`, ['VALIDATION_MISSING_MOVE']);
  });

  it('reports unknown goto targets', () => {
    expectDiagnosticCodes(`tapes 1
blank _
alphabet {_, 0}
input ""
start q0

state q0:
  on _ -> move S; goto missing;
`, ['VALIDATION_UNKNOWN_GOTO']);
  });

  it('reports tape references outside the configured range', () => {
    expectDiagnosticCodes(`tapes 1
blank _
alphabet {_, 0}
input ""
start q0

state q0:
  if t2 = _ then move S;
`, ['VALIDATION_TAPE_REFERENCE_RANGE']);
  });

  it('reports complement patterns when alphabet is missing', () => {
    expectDiagnosticCodes(`tapes 1
blank _
input ""
start q0

state q0:
  on !0 -> move S;
`, ['VALIDATION_COMPLEMENT_REQUIRES_ALPHABET']);
  });

  it('reports symbols outside the alphabet in transitions', () => {
    expectDiagnosticCodes(`tapes 1
blank _
alphabet {_, 0}
input ""
start q0

state q0:
  on 1 -> write 1; move S;
`, ['VALIDATION_SYMBOL_NOT_IN_ALPHABET']);
  });
});
