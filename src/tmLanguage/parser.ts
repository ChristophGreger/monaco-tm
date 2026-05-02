import { HEADER_KEYWORDS, RESERVED_WORDS } from './constants';
import { lex } from './lexer';
import { diagnostic, mergeRanges, tokenRange } from './ranges';
import type {
  ConditionAtom,
  Diagnostic,
  Direction,
  InputSegment,
  ProgramAst,
  ReadMatcher,
  SourceRange,
  StateBlock,
  Token,
  Transition,
  TransitionActions,
  WriteValue,
} from './types';

// The parser is intentionally a simple token cursor, not a grammar generator.
// It builds a shallow AST, records recoverable syntax errors, and leaves
// cross-reference checks and alphabet expansion to validation.ts.
interface ParserState {
  tokens: Token[];
  current: number;
  diagnostics: Diagnostic[];
  ast: ProgramAst;
  transitionId: number;
}

type HeaderKey = keyof ProgramAst['header'];
type AnyHeaderField = NonNullable<ProgramAst['header'][HeaderKey]>;

export function parseSyntax(source: string): {
  ast: ProgramAst;
  tokens: Token[];
  diagnostics: Diagnostic[];
} {
  const lexed = lex(source);
  const state: ParserState = {
    tokens: lexed.tokens,
    current: 0,
    diagnostics: [...lexed.diagnostics],
    ast: { header: {}, states: [] },
    transitionId: 0,
  };

  // Top-level syntax is line-oriented: header declarations first by convention,
  // then any number of state blocks. Semantic ordering checks happen later.
  while (!isAtEnd(state)) {
    skipBlankLines(state);

    if (isAtEnd(state)) {
      break;
    }

    if (matchWord(state, 'state')) {
      parseState(state, previous(state));
      continue;
    }

    if (peek(state).kind === 'word' && HEADER_KEYWORDS.has(peek(state).value)) {
      parseHeaderLine(state);
      continue;
    }

    state.diagnostics.push(
      diagnostic(
        'PARSE_EXPECTED_TOP_LEVEL',
        'Expected a header declaration or a state block.',
        tokenRange(peek(state)),
      ),
    );
    skipLine(state);
  }

  return {
    ast: state.ast,
    tokens: lexed.tokens.filter((token) => token.kind !== 'eof'),
    diagnostics: state.diagnostics,
  };
}

function parseHeaderLine(state: ParserState) {
  const keyword = advance(state);

  switch (keyword.value) {
    case 'tapes':
      parseTapesHeader(state, keyword.range);
      break;
    case 'blank':
      parseBlankHeader(state, keyword.range);
      break;
    case 'alphabet':
      parseAlphabetHeader(state, keyword.range);
      break;
    case 'input':
      parseInputHeader(state, keyword.range);
      break;
    case 'start':
      parseStartHeader(state, keyword.range);
      break;
    default:
      break;
  }

  if (!check(state, 'newline') && !check(state, 'eof')) {
    state.diagnostics.push(
      diagnostic(
        'PARSE_TRAILING_HEADER_TOKENS',
        'Unexpected tokens after this header declaration.',
        tokenRange(peek(state)),
      ),
    );
    skipLine(state);
  }

  consumeNewline(state);
}

// Header parsers collect raw values and ranges only. They do not check whether
// values make sense together, because that requires global context.
function parseTapesHeader(state: ParserState, startRange: SourceRange) {
  const count = consumeKind(state, 'number', 'Expected a tape count.');
  if (!count) {
    return;
  }

  setHeaderField(state, 'tapes', {
    value: Number.parseInt(count.value, 10),
    range: mergeRanges(startRange, count.range),
  });
}

function parseBlankHeader(state: ParserState, startRange: SourceRange) {
  const symbol = parseSymbolToken(state, 'Expected a blank symbol.');
  if (!symbol) {
    return;
  }

  setHeaderField(state, 'blank', {
    value: symbol.value,
    range: mergeRanges(startRange, symbol.range),
  });
}

function parseAlphabetHeader(state: ParserState, startRange: SourceRange) {
  const open = consumeValue(state, '{', 'Expected `{` after `alphabet`.');
  if (!open) {
    return;
  }

  const symbols: string[] = [];
  let endRange = open.range;

  while (!checkValue(state, '}') && !check(state, 'newline') && !isAtEnd(state)) {
    const symbol = parseSymbolToken(state, 'Expected an alphabet symbol.');
    if (!symbol) {
      skipUntilValueOrLine(state, [',', '}']);
    } else {
      symbols.push(symbol.value);
      endRange = symbol.range;
    }

    if (!matchValue(state, ',')) {
      break;
    }
  }

  const close = consumeValue(state, '}', 'Expected `}` after alphabet symbols.');
  if (close) {
    endRange = close.range;
  }

  setHeaderField(state, 'alphabet', {
    value: symbols,
    range: mergeRanges(startRange, endRange),
  });
}

function parseInputHeader(state: ParserState, startRange: SourceRange) {
  const segments: InputSegment[] = [];
  let endRange = startRange;

  while (!check(state, 'newline') && !isAtEnd(state)) {
    const segment = consumeKind(state, 'string', 'Expected an input string.');
    if (!segment) {
      break;
    }

    segments.push({ value: segment.value, range: segment.range });
    endRange = segment.range;

    if (!matchValue(state, '|')) {
      break;
    }
  }

  setHeaderField(state, 'input', {
    value: segments,
    range: mergeRanges(startRange, endRange),
  });
}

function parseStartHeader(state: ParserState, startRange: SourceRange) {
  const name = parseStateNameToken(state, 'Expected a start state name.');
  if (!name) {
    return;
  }

  setHeaderField(state, 'start', {
    value: name.value,
    range: mergeRanges(startRange, name.range),
  });
}

function setHeaderField<TKey extends HeaderKey>(
  state: ParserState,
  key: TKey,
  field: AnyHeaderField,
) {
  if (state.ast.header[key]) {
    state.diagnostics.push(
      diagnostic(
        'PARSE_DUPLICATE_HEADER',
        `Duplicate \`${key}\` header. Only one declaration is allowed.`,
        field.range,
      ),
    );
  }

  // TypeScript cannot narrow an indexed optional union here, so assignment is
  // explicit per key while the caller still gets a generic helper.
  switch (key) {
    case 'tapes':
      state.ast.header.tapes = field as ProgramAst['header']['tapes'];
      break;
    case 'blank':
      state.ast.header.blank = field as ProgramAst['header']['blank'];
      break;
    case 'alphabet':
      state.ast.header.alphabet = field as ProgramAst['header']['alphabet'];
      break;
    case 'input':
      state.ast.header.input = field as ProgramAst['header']['input'];
      break;
    case 'start':
      state.ast.header.start = field as ProgramAst['header']['start'];
      break;
  }
}

function parseState(state: ParserState, stateKeyword: Token) {
  const name = parseStateNameToken(state, 'Expected a state name.');
  if (!name) {
    skipLine(state);
    return;
  }

  const colon = consumeValue(state, ':', 'Expected `:` after the state name.');
  const stateBlock: StateBlock = {
    name: name.value,
    range: mergeRanges(stateKeyword.range, colon?.range ?? name.range),
    nameRange: name.range,
    transitions: [],
  };
  state.ast.states.push(stateBlock);
  consumeNewline(state);

  // State bodies run until the next `state` keyword. Indentation is intentionally
  // ignored so formatting remains cosmetic.
  while (!isAtEnd(state) && !checkWord(state, 'state')) {
    skipBlankLines(state);

    if (isAtEnd(state) || checkWord(state, 'state')) {
      break;
    }

    if (matchWord(state, 'halt')) {
      const haltToken = previous(state);
      if (stateBlock.halt) {
        state.diagnostics.push(
          diagnostic(
            'PARSE_DUPLICATE_HALT',
            'This state already has a halt declaration.',
            haltToken.range,
          ),
        );
      }
      stateBlock.halt = haltToken.range;
      rejectTrailingRuleTokens(state);
      consumeNewline(state);
      continue;
    }

    if (matchWord(state, 'on')) {
      parseOnTransition(state, stateBlock, previous(state));
      continue;
    }

    if (matchWord(state, 'if')) {
      parseIfTransition(state, stateBlock, previous(state));
      continue;
    }

    state.diagnostics.push(
      diagnostic(
        'PARSE_EXPECTED_RULE',
        'Expected `halt`, `on`, or `if` inside this state.',
        tokenRange(peek(state)),
      ),
    );
    skipLine(state);
  }
}

function parseOnTransition(
  state: ParserState,
  stateBlock: StateBlock,
  startToken: Token,
) {
  const read: ReadMatcher[] = [];
  let conditionEnd = startToken.range;

  // Compact patterns are parsed as a list of matchers separated by `/`.
  // Validation later checks that the count matches the configured tape count.
  while (!checkValue(state, '->') && !check(state, 'newline') && !isAtEnd(state)) {
    const matcher = parseReadPatternElement(state);
    if (matcher) {
      read.push(matcher);
      conditionEnd = matcher.range;
    }

    if (!matchValue(state, '/')) {
      break;
    }
  }

  consumeValue(state, '->', 'Expected `->` after the read pattern.');
  parseActionTail(state, stateBlock, {
    kind: 'on',
    read,
    range: mergeRanges(startToken.range, conditionEnd),
  });
}

function parseIfTransition(
  state: ParserState,
  stateBlock: StateBlock,
  startToken: Token,
) {
  const atoms: ConditionAtom[] = [];
  let conditionEnd = startToken.range;

  // Only `and` is supported. Missing tape references are not materialized here;
  // validation fills unmentioned tapes with `any`.
  while (!checkWord(state, 'then') && !check(state, 'newline') && !isAtEnd(state)) {
    const atom = parseConditionAtom(state);
    if (atom) {
      atoms.push(atom);
      conditionEnd = atom.range;
    } else {
      skipUntilWordOrLine(state, ['and', 'then']);
    }

    if (!matchWord(state, 'and')) {
      break;
    }
  }

  consumeWord(state, 'then', 'Expected `then` after the condition.');
  parseActionTail(state, stateBlock, {
    kind: 'if',
    atoms,
    range: mergeRanges(startToken.range, conditionEnd),
  });
}

function parseActionTail(
  state: ParserState,
  stateBlock: StateBlock,
  condition: Transition['condition'],
) {
  // `choose` is syntactic sugar: every branch becomes an independent transition
  // with the same read condition.
  if (matchWord(state, 'choose')) {
    parseChooseBlock(state, stateBlock, condition);
    return;
  }

  const actions = parseActionLine(state);
  if (actions) {
    addTransition(state, stateBlock, condition, actions);
  }
  consumeNewline(state);
}

function parseChooseBlock(
  state: ParserState,
  stateBlock: StateBlock,
  condition: Transition['condition'],
) {
  consumeValue(state, '{', 'Expected `{` after `choose`.');
  consumeNewline(state);

  while (!checkValue(state, '}') && !isAtEnd(state)) {
    skipBlankLines(state);
    if (checkValue(state, '}') || isAtEnd(state)) {
      break;
    }

    const actions = parseActionLine(state);
    if (actions) {
      addTransition(state, stateBlock, condition, actions);
    }
    consumeNewline(state);
  }

  consumeValue(state, '}', 'Expected `}` to close the choose block.');
  rejectTrailingRuleTokens(state);
  consumeNewline(state);
}

function addTransition(
  state: ParserState,
  stateBlock: StateBlock,
  condition: Transition['condition'],
  actions: TransitionActions,
) {
  stateBlock.transitions.push({
    id: `${stateBlock.name}:${state.transitionId++}`,
    from: stateBlock.name,
    condition,
    actions,
    range: mergeRanges(condition.range, actions.range),
  });
}

function parseConditionAtom(state: ParserState): ConditionAtom | undefined {
  const start = peek(state);

  if (matchWord(state, 'any')) {
    const tape = parseTapeReference(state);
    if (!tape) {
      return undefined;
    }

    return {
      tape: tape.index,
      matcher: { kind: 'any', range: mergeRanges(start.range, tape.range) },
      range: mergeRanges(start.range, tape.range),
    };
  }

  const tape = parseTapeReference(state);
  if (!tape) {
    state.diagnostics.push(
      diagnostic(
        'PARSE_EXPECTED_TAPE_REFERENCE',
        'Expected a tape reference such as `t1`.',
        tokenRange(peek(state)),
      ),
    );
    return undefined;
  }

  if (matchValue(state, '=')) {
    const symbol = parseSymbolToken(state, 'Expected a symbol after `=`.');
    if (!symbol) {
      return undefined;
    }

    return {
      tape: tape.index,
      matcher: { kind: 'equals', symbol: symbol.value, range: symbol.range },
      range: mergeRanges(tape.range, symbol.range),
    };
  }

  if (matchValue(state, '!=')) {
    const symbol = parseSymbolToken(state, 'Expected a symbol after `!=`.');
    if (!symbol) {
      return undefined;
    }

    return {
      tape: tape.index,
      matcher: { kind: 'notEquals', symbol: symbol.value, range: symbol.range },
      range: mergeRanges(tape.range, symbol.range),
    };
  }

  if (matchWord(state, 'in')) {
    const set = parseSymbolSet(state);
    if (!set) {
      return undefined;
    }

    return {
      tape: tape.index,
      matcher: { kind: 'in', symbols: set.symbols, range: set.range },
      range: mergeRanges(tape.range, set.range),
    };
  }

  if (matchWord(state, 'not')) {
    const notToken = previous(state);
    consumeWord(state, 'in', 'Expected `in` after `not`.');
    const set = parseSymbolSet(state);
    if (!set) {
      return undefined;
    }

    return {
      tape: tape.index,
      matcher: { kind: 'notIn', symbols: set.symbols, range: mergeRanges(notToken.range, set.range) },
      range: mergeRanges(tape.range, set.range),
    };
  }

  state.diagnostics.push(
    diagnostic(
      'PARSE_EXPECTED_CONDITION_OPERATOR',
      'Expected `=`, `!=`, `in`, or `not in` after the tape reference.',
      tokenRange(peek(state)),
    ),
  );
  return undefined;
}

// Read pattern elements intentionally keep complement/set forms symbolic.
// Expanding them requires the alphabet, which belongs in validation.
function parseReadPatternElement(state: ParserState): ReadMatcher | undefined {
  if (matchValue(state, '*')) {
    return { kind: 'any', range: previous(state).range };
  }

  if (matchValue(state, '!')) {
    const start = previous(state);
    const symbol = parseSymbolToken(state, 'Expected a symbol after `!`.');
    if (!symbol) {
      return undefined;
    }

    return {
      kind: 'notEquals',
      symbol: symbol.value,
      range: mergeRanges(start.range, symbol.range),
    };
  }

  if (checkValue(state, '{')) {
    const set = parseSymbolSet(state);
    if (!set) {
      return undefined;
    }

    return { kind: 'in', symbols: set.symbols, range: set.range };
  }

  const symbol = parseSymbolToken(state, 'Expected a read-pattern element.');
  if (!symbol) {
    return undefined;
  }

  return { kind: 'equals', symbol: symbol.value, range: symbol.range };
}

function parseSymbolSet(
  state: ParserState,
): { symbols: string[]; range: SourceRange } | undefined {
  const open = consumeValue(state, '{', 'Expected `{` to start a symbol set.');
  if (!open) {
    return undefined;
  }

  const symbols: string[] = [];
  let endRange = open.range;

  while (!checkValue(state, '}') && !check(state, 'newline') && !isAtEnd(state)) {
    const symbol = parseSymbolToken(state, 'Expected a symbol in the set.');
    if (symbol) {
      symbols.push(symbol.value);
      endRange = symbol.range;
    } else {
      skipUntilValueOrLine(state, [',', '}']);
    }

    if (!matchValue(state, ',')) {
      break;
    }
  }

  const close = consumeValue(state, '}', 'Expected `}` to close the symbol set.');
  if (close) {
    endRange = close.range;
  }

  return { symbols, range: mergeRanges(open.range, endRange) };
}

function parseActionLine(state: ParserState): TransitionActions | undefined {
  const start = peek(state);
  const actions: TransitionActions = {
    range: start.range,
  };
  let sawAction = false;
  let endRange = start.range;

  // Action order is flexible. Duplicates are reported, but the parser still
  // consumes the full line so the editor can keep showing later diagnostics.
  while (!check(state, 'newline') && !checkValue(state, '}') && !isAtEnd(state)) {
    if (matchWord(state, 'write')) {
      const keyword = previous(state);
      if (actions.write) {
        state.diagnostics.push(
          diagnostic(
            'PARSE_DUPLICATE_WRITE',
            'A transition may contain only one write action.',
            keyword.range,
          ),
        );
      }
      const values = parseWritePattern(state);
      consumeValue(state, ';', 'Expected `;` after the write action.');
      actions.write = values;
      sawAction = true;
      endRange = previous(state).range;
      continue;
    }

    if (matchWord(state, 'move')) {
      const keyword = previous(state);
      if (actions.move) {
        state.diagnostics.push(
          diagnostic(
            'PARSE_DUPLICATE_MOVE',
            'A transition may contain only one move action.',
            keyword.range,
          ),
        );
      }
      const directions = parseMovePattern(state);
      const semicolon = consumeValue(state, ';', 'Expected `;` after the move action.');
      actions.move = directions.map((direction) => direction.value);
      actions.moveRange = mergeRanges(keyword.range, semicolon?.range ?? previous(state).range);
      sawAction = true;
      endRange = previous(state).range;
      continue;
    }

    if (matchWord(state, 'goto')) {
      const keyword = previous(state);
      if (actions.goto) {
        state.diagnostics.push(
          diagnostic(
            'PARSE_DUPLICATE_GOTO',
            'A transition may contain only one goto action.',
            keyword.range,
          ),
        );
      }
      const target = parseStateNameToken(state, 'Expected a target state name.');
      const semicolon = consumeValue(state, ';', 'Expected `;` after the goto action.');
      if (target) {
        actions.goto = target.value;
        actions.gotoRange = mergeRanges(keyword.range, semicolon?.range ?? target.range);
      }
      sawAction = true;
      endRange = previous(state).range;
      continue;
    }

    state.diagnostics.push(
      diagnostic(
        'PARSE_EXPECTED_ACTION',
        'Expected `write`, `move`, or `goto`.',
        tokenRange(peek(state)),
      ),
    );
    skipLine(state);
    break;
  }

  actions.range = mergeRanges(start.range, endRange);
  return sawAction ? actions : undefined;
}

function parseWritePattern(state: ParserState): WriteValue[] {
  const values: WriteValue[] = [];

  while (!checkValue(state, ';') && !check(state, 'newline') && !isAtEnd(state)) {
    if (matchWord(state, 'same')) {
      values.push({ kind: 'same', range: previous(state).range });
    } else {
      const symbol = parseSymbolToken(state, 'Expected `same` or a symbol.');
      if (symbol) {
        values.push({ kind: 'symbol', symbol: symbol.value, range: symbol.range });
      } else {
        skipUntilValueOrLine(state, ['/', ';']);
      }
    }

    if (!matchValue(state, '/')) {
      break;
    }
  }

  return values;
}

function parseMovePattern(state: ParserState): Array<{ value: Direction; range: SourceRange }> {
  const directions: Array<{ value: Direction; range: SourceRange }> = [];

  while (!checkValue(state, ';') && !check(state, 'newline') && !isAtEnd(state)) {
    const token = advance(state);
    if (token.value === 'L' || token.value === 'R' || token.value === 'S') {
      directions.push({ value: token.value, range: token.range });
    } else {
      state.diagnostics.push(
        diagnostic(
          'PARSE_INVALID_DIRECTION',
          'Expected a move direction: `L`, `R`, or `S`.',
          token.range,
        ),
      );
    }

    if (!matchValue(state, '/')) {
      break;
    }
  }

  return directions;
}

function parseTapeReference(
  state: ParserState,
): { index: number; range: SourceRange } | undefined {
  const token = peek(state);
  const match = /^t([1-9][0-9]*)$/.exec(token.value);

  if (token.kind !== 'word' || !match) {
    return undefined;
  }

  advance(state);
  return { index: Number.parseInt(match[1], 10), range: token.range };
}

function parseSymbolToken(
  state: ParserState,
  message: string,
): { value: string; range: SourceRange } | undefined {
  const token = peek(state);

  // Quoted symbols are the escape hatch for reserved words such as "same".
  if (token.kind === 'string') {
    advance(state);
    return { value: token.value, range: token.range };
  }

  if (
    token.kind === 'word' ||
    token.kind === 'number' ||
    token.value === '#' ||
    token.value === '_' ||
    token.value === '*'
  ) {
    if (token.kind === 'word' && RESERVED_WORDS.has(token.value)) {
      state.diagnostics.push(
        diagnostic(
          'PARSE_RESERVED_SYMBOL',
          `\`${token.value}\` is reserved. Quote it to use it as a symbol.`,
          token.range,
        ),
      );
    }
    advance(state);
    return { value: token.value, range: token.range };
  }

  state.diagnostics.push(diagnostic('PARSE_EXPECTED_SYMBOL', message, token.range));
  return undefined;
}

function parseStateNameToken(
  state: ParserState,
  message: string,
): { value: string; range: SourceRange } | undefined {
  const token = peek(state);

  if (token.kind !== 'word' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(token.value)) {
    state.diagnostics.push(diagnostic('PARSE_EXPECTED_STATE_NAME', message, token.range));
    return undefined;
  }

  if (RESERVED_WORDS.has(token.value)) {
    state.diagnostics.push(
      diagnostic(
        'PARSE_RESERVED_STATE_NAME',
        `\`${token.value}\` is reserved and cannot be used as a state name.`,
        token.range,
      ),
    );
  }

  advance(state);
  return { value: token.value, range: token.range };
}

function rejectTrailingRuleTokens(state: ParserState) {
  if (!check(state, 'newline') && !check(state, 'eof')) {
    state.diagnostics.push(
      diagnostic(
        'PARSE_TRAILING_RULE_TOKENS',
        'Unexpected tokens after this rule.',
        tokenRange(peek(state)),
      ),
    );
    skipLine(state);
  }
}

// The consume/match helpers are the parser's error-recovery boundary. `consume`
// reports a diagnostic when the expected token is missing; `match` stays silent.
function consumeKind(
  state: ParserState,
  kind: Token['kind'],
  message: string,
): Token | undefined {
  if (check(state, kind)) {
    return advance(state);
  }

  state.diagnostics.push(diagnostic('PARSE_UNEXPECTED_TOKEN', message, tokenRange(peek(state))));
  return undefined;
}

function consumeValue(
  state: ParserState,
  value: string,
  message: string,
): Token | undefined {
  if (checkValue(state, value)) {
    return advance(state);
  }

  state.diagnostics.push(diagnostic('PARSE_UNEXPECTED_TOKEN', message, tokenRange(peek(state))));
  return undefined;
}

function consumeWord(
  state: ParserState,
  value: string,
  message: string,
): Token | undefined {
  if (checkWord(state, value)) {
    return advance(state);
  }

  state.diagnostics.push(diagnostic('PARSE_UNEXPECTED_TOKEN', message, tokenRange(peek(state))));
  return undefined;
}

function skipUntilValueOrLine(state: ParserState, values: string[]) {
  while (
    !isAtEnd(state) &&
    !check(state, 'newline') &&
    !values.some((value) => checkValue(state, value))
  ) {
    advance(state);
  }
}

function skipUntilWordOrLine(state: ParserState, values: string[]) {
  while (
    !isAtEnd(state) &&
    !check(state, 'newline') &&
    !values.some((value) => checkWord(state, value))
  ) {
    advance(state);
  }
}

function skipLine(state: ParserState) {
  while (!isAtEnd(state) && !check(state, 'newline')) {
    advance(state);
  }
}

function skipBlankLines(state: ParserState) {
  while (check(state, 'newline')) {
    advance(state);
  }
}

function consumeNewline(state: ParserState) {
  if (check(state, 'newline')) {
    advance(state);
  }
}

function matchWord(state: ParserState, value: string): boolean {
  if (!checkWord(state, value)) {
    return false;
  }
  advance(state);
  return true;
}

function matchValue(state: ParserState, value: string): boolean {
  if (!checkValue(state, value)) {
    return false;
  }
  advance(state);
  return true;
}

function checkWord(state: ParserState, value: string): boolean {
  return peek(state).kind === 'word' && peek(state).value === value;
}

function checkValue(state: ParserState, value: string): boolean {
  return peek(state).value === value;
}

function check(state: ParserState, kind: Token['kind']): boolean {
  return peek(state).kind === kind;
}

function advance(state: ParserState): Token {
  if (!isAtEnd(state)) {
    state.current += 1;
  }
  return previous(state);
}

function previous(state: ParserState): Token {
  return state.tokens[state.current - 1];
}

function peek(state: ParserState): Token {
  return state.tokens[state.current];
}

function isAtEnd(state: ParserState): boolean {
  return peek(state).kind === 'eof';
}
