import { useCallback, useState } from 'react';
import Editor from '@monaco-editor/react';
import type { BeforeMount, OnMount } from '@monaco-editor/react';
import { parseTuringMachine } from '../tmLanguage';
import {
  LANGUAGE_ID,
  registerTuringVizLanguage,
  updateTuringVizMarkers,
} from '../editor/turingVizLanguage';

// The editor opens with a representative program so language features are
// visible immediately: multi-tape reads, readable conditions, and a terminal state.
const initialCode = `tapes 4
blank _
alphabet {0, 1, #, _}
input "1010" | "" | "" | ""
start q0

state q0:
  on 1/0/1/0 -> write same/same/0/_; move R/S/L/R; goto q1;
  if t1 = _ and t2 != 1 then move S/S/S/S; goto accept;

state q1:
  on */*/1/0 -> move S/R/S/L; goto q0;

state accept:
`;

export function MonacoLoader() {
  const [code, setCode] = useState(initialCode);

  function handleLoad() {
    // Keep loading separate from editor services: the domain parser owns the
    // parsed representation that callers can consume.
    console.log('Parsed TuringViz machine:', parseTuringMachine(code));
  }

  const handleBeforeMount: BeforeMount = useCallback((monaco) => {
    registerTuringVizLanguage(monaco);
  }, []);

  const handleMount: OnMount = useCallback((editor, monaco) => {
    updateTuringVizMarkers(monaco, editor.getModel());
    // The parser is cheap enough to run on the whole document after each edit.
    editor.onDidChangeModelContent(() => {
      updateTuringVizMarkers(monaco, editor.getModel());
    });
  }, []);

  return (
    <main className="monaco-loader">
      <button className="load-button" type="button" onClick={handleLoad}>
        Load
      </button>
      <section className="editor-pane" aria-label="Monaco editor">
        <Editor
          beforeMount={handleBeforeMount}
          language={LANGUAGE_ID}
          theme="turingviz-dark"
          value={code}
          onChange={(value) => setCode(value ?? '')}
          onMount={handleMount}
          options={{
            automaticLayout: true,
            fontSize: 14,
            minimap: { enabled: false },
          }}
        />
      </section>
    </main>
  );
}
