import { useEffect, useMemo, useRef, useState } from "react";
import * as Blockly from "blockly";
import { javascriptGenerator } from "blockly/javascript";
import {
  BLOCKLY_CONTEXT_PRESETS,
  DEFAULT_BLOCKLY_CONTEXT,
  MERGE_STRATEGIES,
} from "../mmss/promptTypes";
import { DEFAULT_BLOCKLY_WORKSPACE_XML } from "../mmss/promptLibrary";

let customBlocksRegistered = false;
let blockOptionsProvider = () => [["No blocks", "__none__"]];
let sequenceOptionsProvider = () => [["No sequences", "__none__"]];

function PromptLogicBlocklyPanel({
  blocks,
  sequences,
  onSetActiveComposition,
  onClearActiveComposition,
  initialContext,
  initialWorkspaceXml,
  onWorkspaceXmlChange,
}) {
  const containerRef = useRef(null);
  const workspaceRef = useRef(null);
  const onWorkspaceXmlChangeRef = useRef(onWorkspaceXmlChange);
  const initialWorkspaceXmlRef = useRef(initialWorkspaceXml);
  const [runtimeContext, setRuntimeContext] = useState(() => ({
    ...DEFAULT_BLOCKLY_CONTEXT,
    ...(initialContext || {}),
  }));
  const [selectedPreset, setSelectedPreset] = useState("neuro_dark");
  const [runError, setRunError] = useState("");

  const toolbox = useMemo(
    () => ({
      kind: "categoryToolbox",
      contents: [
        {
          kind: "category",
          name: "MMSS Logic",
          colour: "#5f9bff",
          contents: [
            { kind: "block", type: "mmss_prompt_condition" },
            { kind: "block", type: "mmss_add_block" },
            { kind: "block", type: "mmss_use_sequence" },
            { kind: "block", type: "mmss_set_merge_strategy" },
          ],
        },
        {
          kind: "category",
          name: "Logic",
          colour: "#8f63d8",
          contents: [
            { kind: "block", type: "controls_if" },
            { kind: "block", type: "logic_compare" },
            { kind: "block", type: "logic_operation" },
            { kind: "block", type: "logic_boolean" },
          ],
        },
      ],
    }),
    []
  );

  useEffect(() => {
    onWorkspaceXmlChangeRef.current = onWorkspaceXmlChange;
  }, [onWorkspaceXmlChange]);

  useEffect(() => {
    blockOptionsProvider = () => toDropdownOptions(blocks);
    sequenceOptionsProvider = () => toDropdownOptions(sequences);
    registerCustomBlocks();
  }, [blocks, sequences]);

  useEffect(() => {
    registerCustomBlocks();
    if (!containerRef.current || workspaceRef.current) return;
    const workspace = Blockly.inject(containerRef.current, {
      toolbox,
      trashcan: true,
      renderer: "geras",
      move: { wheel: true },
      zoom: {
        controls: true,
        wheel: true,
        startScale: 0.9,
        maxScale: 2,
        minScale: 0.4,
        scaleSpeed: 1.1,
      },
    });
    workspaceRef.current = workspace;

    const xmlText =
      typeof initialWorkspaceXmlRef.current === "string" && initialWorkspaceXmlRef.current.trim()
        ? initialWorkspaceXmlRef.current
        : DEFAULT_BLOCKLY_WORKSPACE_XML;
    restoreWorkspace(workspace, xmlText);

    const changeListener = () => {
      if (!onWorkspaceXmlChangeRef.current) return;
      try {
        const xml = Blockly.Xml.domToText(Blockly.Xml.workspaceToDom(workspace));
        onWorkspaceXmlChangeRef.current(xml);
      } catch (error) {
        // Keep runtime stable even if workspace XML conversion fails.
      }
    };
    workspace.addChangeListener(changeListener);

    return () => {
      workspace.removeChangeListener(changeListener);
      workspace.dispose();
      workspaceRef.current = null;
    };
  }, [toolbox]);

  useEffect(() => {
    setRuntimeContext((current) => ({
      ...current,
      ...(initialContext || {}),
    }));
  }, [initialContext]);

  function handleApply() {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    setRunError("");

    try {
      const code = javascriptGenerator.workspaceToCode(workspace);
      const composition = [];
      let mergeStrategy = "merge_deep";

      const addBlock = (id) => {
        if (!id || id === "__none__") return;
        if (!blocks.some((block) => block.id === id)) return;
        composition.push(id);
      };

      const addSequence = (sequenceId) => {
        if (!sequenceId || sequenceId === "__none__") return;
        const sequence = sequences.find((item) => item.id === sequenceId);
        if (!sequence) return;
        const ids = [...sequence.blocks]
          .sort((left, right) => Number(left.order) - Number(right.order))
          .map((entry) => entry.blockId);
        ids.forEach((id) => addBlock(id));
      };

      const setMergeStrategy = (value) => {
        if (MERGE_STRATEGIES.includes(value)) mergeStrategy = value;
      };

      // eslint-disable-next-line no-new-func
      const executor = new Function(
        "context",
        "addBlock",
        "addSequence",
        "setMergeStrategy",
        `"use strict";\n${code}`
      );
      executor(runtimeContext, addBlock, addSequence, setMergeStrategy);

      const workspaceXml = Blockly.Xml.domToText(Blockly.Xml.workspaceToDom(workspace));
      onSetActiveComposition(composition, mergeStrategy, {
        source: "blockly",
        workspaceXml,
        context: runtimeContext,
      });
    } catch (error) {
      setRunError(error.message || "Blockly execution failed");
    }
  }

  function handleReset() {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    restoreWorkspace(workspace, DEFAULT_BLOCKLY_WORKSPACE_XML);
    setRunError("");
    if (onClearActiveComposition) onClearActiveComposition();
    if (onWorkspaceXmlChange) onWorkspaceXmlChange(DEFAULT_BLOCKLY_WORKSPACE_XML);
  }

  function handleContextPreset(value) {
    setSelectedPreset(value);
    const preset = BLOCKLY_CONTEXT_PRESETS[value];
    if (!preset) return;
    setRuntimeContext((current) => ({
      ...current,
      ...preset,
    }));
  }

  return (
    <div className="blockly-panel">
      <div className="blockly-header">
        <div>
          <strong>Prompt Logic Blockly</strong>
          <p>
            Visual rule layer for active composition. Build flow with blocks, then apply to
            Prompt Library.
          </p>
        </div>
        <div className="blockly-context-controls">
          <label>
            Context preset
            <select
              value={selectedPreset}
              onChange={(event) => handleContextPreset(event.target.value)}
            >
              {Object.keys(BLOCKLY_CONTEXT_PRESETS).map((key) => (
                <option key={key} value={key}>
                  {key}
                </option>
              ))}
            </select>
          </label>
          <label>
            Genre
            <input
              value={runtimeContext.genre || ""}
              onChange={(event) =>
                setRuntimeContext((current) => ({ ...current, genre: event.target.value }))
              }
            />
          </label>
          <label>
            Mood
            <input
              value={runtimeContext.mood || ""}
              onChange={(event) =>
                setRuntimeContext((current) => ({ ...current, mood: event.target.value }))
              }
            />
          </label>
        </div>
      </div>

      <div className="blockly-workspace" ref={containerRef} />

      <div className="blockly-footer">
        <button className="accent-action" onClick={handleApply}>
          Применить блоки
        </button>
        <button onClick={handleReset}>Сбросить</button>
      </div>

      {runError ? <div className="json-error">Blockly error: {runError}</div> : null}
    </div>
  );
}

function toDropdownOptions(items) {
  if (!Array.isArray(items) || !items.length) return [["No entries", "__none__"]];
  return items.map((item) => [item.name || item.id, item.id]);
}

function restoreWorkspace(workspace, xmlText) {
  workspace.clear();
  try {
    const dom = Blockly.utils.xml.textToDom(xmlText || DEFAULT_BLOCKLY_WORKSPACE_XML);
    Blockly.Xml.domToWorkspace(dom, workspace);
  } catch (error) {
    const fallback = Blockly.utils.xml.textToDom(DEFAULT_BLOCKLY_WORKSPACE_XML);
    Blockly.Xml.domToWorkspace(fallback, workspace);
  }
}

function registerCustomBlocks() {
  if (customBlocksRegistered) return;
  customBlocksRegistered = true;

  Blockly.Blocks.mmss_prompt_condition = {
    init() {
      this.appendValueInput("COND").setCheck("Boolean").appendField("if");
      this.appendStatementInput("DO").appendField("then");
      this.setPreviousStatement(true);
      this.setNextStatement(true);
      this.setColour(210);
      this.setTooltip("Conditional MMSS prompt logic.");
    },
  };

  Blockly.Blocks.mmss_add_block = {
    init() {
      this.appendDummyInput()
        .appendField("add block")
        .appendField(new Blockly.FieldDropdown(() => blockOptionsProvider()), "BLOCK_ID");
      this.setPreviousStatement(true);
      this.setNextStatement(true);
      this.setColour(180);
      this.setTooltip("Add selected JSON block by id.");
    },
  };

  Blockly.Blocks.mmss_use_sequence = {
    init() {
      this.appendDummyInput()
        .appendField("use sequence")
        .appendField(new Blockly.FieldDropdown(() => sequenceOptionsProvider()), "SEQUENCE_ID");
      this.setPreviousStatement(true);
      this.setNextStatement(true);
      this.setColour(160);
      this.setTooltip("Expand and add sequence blocks.");
    },
  };

  Blockly.Blocks.mmss_set_merge_strategy = {
    init() {
      this.appendDummyInput()
        .appendField("set merge strategy")
        .appendField(
          new Blockly.FieldDropdown([
            ["concat", "concat"],
            ["merge_shallow", "merge_shallow"],
            ["merge_deep", "merge_deep"],
          ]),
          "MERGE_STRATEGY"
        );
      this.setPreviousStatement(true);
      this.setNextStatement(true);
      this.setColour(230);
      this.setTooltip("Set prompt composition merge strategy.");
    },
  };

  javascriptGenerator.forBlock.mmss_prompt_condition = function (block, generator) {
    const conditionCode = generator.valueToCode(block, "COND", javascriptGenerator.ORDER_NONE) || "false";
    const branch = generator.statementToCode(block, "DO");
    return `if (${conditionCode}) {\n${branch}}\n`;
  };

  javascriptGenerator.forBlock.mmss_add_block = function (block) {
    const blockId = block.getFieldValue("BLOCK_ID");
    return `addBlock(${JSON.stringify(blockId)});\n`;
  };

  javascriptGenerator.forBlock.mmss_use_sequence = function (block) {
    const sequenceId = block.getFieldValue("SEQUENCE_ID");
    return `addSequence(${JSON.stringify(sequenceId)});\n`;
  };

  javascriptGenerator.forBlock.mmss_set_merge_strategy = function (block) {
    const strategy = block.getFieldValue("MERGE_STRATEGY");
    return `setMergeStrategy(${JSON.stringify(strategy)});\n`;
  };
}

export default PromptLogicBlocklyPanel;
