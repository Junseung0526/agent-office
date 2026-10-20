/**
 * 에이전트 오피스 (Agent Office) - Claude Code 로그 이벤트 파서 (lib/parsers/claude.js)
 */

const { getRoomForTool } = require('../config');

function parseClaudeLine(line, state) {
  try {
    const obj = JSON.parse(line);
    const events = [];
    const now = Date.parse(obj.timestamp) || Date.now();

    if (obj.type === 'user') {
      let prompt = '사용자 질문';
      if (obj.message && obj.message.content) {
        if (typeof obj.message.content === 'string') prompt = obj.message.content;
        else if (Array.isArray(obj.message.content)) {
          const t = obj.message.content.find(c => c.type === 'text');
          if (t && t.text) prompt = t.text;
          for (const c of obj.message.content) {
            if (c.type === 'tool_result') {
              events.push({
                id: `claude_${state.sessionId}_${c.tool_use_id || Date.now()}_res`,
                sessionId: state.sessionId,
                projectName: state.projectName,
                cwd: state.cwd,
                floor: state.floorNumber,
                agentType: 'claude',
                agentId: 'main',
                timestamp: now,
                action: 'tool_end',
                room: state.currentRoom || 'dev',
                isError: Boolean(c.is_error),
                errorSummary: c.is_error ? (typeof c.content === 'string' ? c.content.slice(0, 120) : '에러') : null,
                resultSummary: typeof c.content === 'string' ? c.content.slice(0, 100) : '결과 수신'
              });
            }
          }
        }
      }
      if (events.length === 0) {
        events.push({
          id: `claude_${state.sessionId}_${Date.now()}_user`,
          sessionId: state.sessionId,
          projectName: state.projectName,
          cwd: state.cwd,
          floor: state.floorNumber,
          agentType: 'claude',
          agentId: 'main',
          timestamp: now,
          action: 'user_input',
          room: 'user_desk',
          userPrompt: prompt.slice(0, 150)
        });
      }
      return events;
    }

    if (obj.type === 'assistant' && obj.message) {
      const msg = obj.message;
      if (Array.isArray(msg.content)) {
        for (let i = 0; i < msg.content.length; i++) {
          const item = msg.content[i];
          if (item.type === 'thinking' && item.thinking && item.thinking.trim()) {
            events.push({
              id: `claude_${state.sessionId}_${Date.now()}_think_${i}`,
              sessionId: state.sessionId,
              projectName: state.projectName,
              cwd: state.cwd,
              floor: state.floorNumber,
              agentType: 'claude',
              agentId: 'main',
              timestamp: now,
              action: 'thinking',
              room: 'meeting',
              thinkingText: item.thinking.trim()
            });
          } else if (item.type === 'tool_use') {
            const toolName = item.name;
            const room = getRoomForTool(toolName);
            state.currentRoom = room;

            if (toolName === 'Agent' || toolName === 'Task') {
              const subId = `sub_${Date.now() % 1000}`;
              state.subagents.add(subId);
              if (state.subagents.size > 100) {
                const oldest = state.subagents.values().next().value;
                state.subagents.delete(oldest);
              }
              events.push({
                id: `claude_${state.sessionId}_${item.id || i}_sub`,
                sessionId: state.sessionId,
                projectName: state.projectName,
                cwd: state.cwd,
                floor: state.floorNumber,
                agentType: 'claude',
                agentId: subId,
                timestamp: now,
                action: 'subagent_spawn',
                room: 'elevator',
                subagentName: item.input && item.input.name ? item.input.name : 'Subagent',
                subagentRole: '작업 위임'
              });
            } else if (toolName === 'AskUserQuestion') {
              events.push({
                id: `claude_${state.sessionId}_${item.id || i}_ask`,
                sessionId: state.sessionId,
                projectName: state.projectName,
                cwd: state.cwd,
                floor: state.floorNumber,
                agentType: 'claude',
                agentId: 'main',
                timestamp: now,
                action: 'ask_user',
                room: 'user_desk',
                questionText: (item.input && item.input.question) || '사용자에게 질문'
              });
            } else {
              events.push({
                id: `claude_${state.sessionId}_${item.id || i}_tool`,
                sessionId: state.sessionId,
                projectName: state.projectName,
                cwd: state.cwd,
                floor: state.floorNumber,
                agentType: 'claude',
                agentId: 'main',
                timestamp: now,
                action: 'tool_start',
                room: room,
                toolName: toolName,
                toolSummary: JSON.stringify(item.input || {}).slice(0, 100),
                toolArgs: item.input || {}
              });
            }
          }
        }
      }

      if (msg.stop_reason === 'end_turn') {
        events.push({
          id: `claude_${state.sessionId}_${Date.now()}_end`,
          sessionId: state.sessionId,
          projectName: state.projectName,
          cwd: state.cwd,
          floor: state.floorNumber,
          agentType: 'claude',
          agentId: 'main',
          timestamp: now,
          action: 'turn_finish',
          room: 'user_desk',
          resultSummary: '턴 종료 및 결과 보고'
        });
      }
      return events;
    }

    return events;
  } catch (err) {
    return [];
  }
}

module.exports = {
  parseClaudeLine
};
