/**
 * 에이전트 오피스 (Agent Office) - Antigravity 로그 이벤트 파서 (lib/parsers/antigravity.js)
 */

const { getRoomForTool } = require('../config');

function parseAntigravityLine(line, state) {
  try {
    const obj = JSON.parse(line);
    const events = [];
    const now = Date.parse(obj.created_at) || Date.now();

    // 1) USER_INPUT
    if (obj.type === 'USER_INPUT') {
      events.push({
        id: `ag_${state.sessionId}_${obj.step_index}_user`,
        sessionId: state.sessionId,
        projectName: state.projectName,
        cwd: state.cwd,
        floor: state.floorNumber,
        agentType: 'antigravity',
        agentId: 'main',
        timestamp: now,
        action: 'user_input',
        room: 'user_desk',
        userPrompt: typeof obj.content === 'string' ? obj.content.slice(0, 150) : '사용자 입력'
      });
      return events;
    }

    // 2) PLANNER_RESPONSE
    if (obj.type === 'PLANNER_RESPONSE') {
      if (obj.thinking && typeof obj.thinking === 'string' && obj.thinking.trim()) {
        events.push({
          id: `ag_${state.sessionId}_${obj.step_index}_think`,
          sessionId: state.sessionId,
          projectName: state.projectName,
          cwd: state.cwd,
          floor: state.floorNumber,
          agentType: 'antigravity',
          agentId: 'main',
          timestamp: now,
          action: 'thinking',
          room: 'meeting',
          thinkingText: obj.thinking.trim()
        });
      }

      if (obj.tool_calls && Array.isArray(obj.tool_calls) && obj.tool_calls.length > 0) {
        for (let i = 0; i < obj.tool_calls.length; i++) {
          const tc = obj.tool_calls[i];
          const rawToolName = tc.name || (tc.function && tc.function.name) || 'unknown';
          let effectiveToolName = rawToolName;
          if (rawToolName === 'call_mcp_tool' && tc.args && (tc.args.ToolName || tc.args.toolName)) {
            const subTool = tc.args.ToolName || tc.args.toolName;
            if (getRoomForTool(subTool) !== 'research') {
              effectiveToolName = subTool;
            }
          }
          const room = getRoomForTool(effectiveToolName);
          const toolName = rawToolName;
          const toolSummary = (tc.args && (tc.args.toolSummary || tc.args.toolAction)) || toolName;

          if (toolName === 'invoke_subagent') {
            const subagents = (tc.args && tc.args.Subagents) || [{ Role: '서브에이전트' }];
            for (let sIdx = 0; sIdx < subagents.length; sIdx++) {
              const sub = subagents[sIdx];
              const subId = `sub_${sIdx + 1}`;
              state.subagents.add(subId);
              if (state.subagents.size > 100) {
                const oldest = state.subagents.values().next().value;
                state.subagents.delete(oldest);
              }
              events.push({
                id: `ag_${state.sessionId}_${obj.step_index}_sub_${sIdx}`,
                sessionId: state.sessionId,
                projectName: state.projectName,
                cwd: state.cwd,
                floor: state.floorNumber,
                agentType: 'antigravity',
                agentId: subId,
                timestamp: now,
                action: 'subagent_spawn',
                room: 'elevator',
                subagentName: sub.TypeName || sub.Role || 'Subagent',
                subagentRole: sub.Role || '작업 지원'
              });
            }
          } else if (toolName === 'ask_question') {
            let questionText = '사용자 의견을 확인하고 있습니다.';
            if (tc.args && tc.args.questions && tc.args.questions[0]) {
              questionText = tc.args.questions[0].question || questionText;
            }
            events.push({
              id: `ag_${state.sessionId}_${obj.step_index}_ask_${i}`,
              sessionId: state.sessionId,
              projectName: state.projectName,
              cwd: state.cwd,
              floor: state.floorNumber,
              agentType: 'antigravity',
              agentId: 'main',
              timestamp: now,
              action: 'ask_user',
              room: 'user_desk',
              questionText: questionText.slice(0, 150)
            });
          } else {
            state.currentRoom = room;
            events.push({
              id: `ag_${state.sessionId}_${obj.step_index}_tool_${i}`,
              sessionId: state.sessionId,
              projectName: state.projectName,
              cwd: state.cwd,
              floor: state.floorNumber,
              agentType: 'antigravity',
              agentId: 'main',
              timestamp: now,
              action: 'tool_start',
              room: room,
              toolName: toolName,
              toolSummary: toolSummary,
              toolArgs: tc.args || {}
            });
          }
        }
      } else if (obj.content && !obj.tool_calls) {
        events.push({
          id: `ag_${state.sessionId}_${obj.step_index}_done`,
          sessionId: state.sessionId,
          projectName: state.projectName,
          cwd: state.cwd,
          floor: state.floorNumber,
          agentType: 'antigravity',
          agentId: 'main',
          timestamp: now,
          action: 'turn_finish',
          room: 'user_desk',
          resultSummary: typeof obj.content === 'string' ? obj.content.slice(0, 150) : '작업 완료'
        });
      }
      return events;
    }

    // 3) GENERIC
    if (obj.type === 'GENERIC') {
      const isError = obj.status === 'ERROR' || (typeof obj.content === 'string' && /error|failed/i.test(obj.content));
      events.push({
        id: `ag_${state.sessionId}_${obj.step_index}_res`,
        sessionId: state.sessionId,
        projectName: state.projectName,
        cwd: state.cwd,
        floor: state.floorNumber,
        agentType: 'antigravity',
        agentId: 'main',
        timestamp: now,
        action: 'tool_end',
        room: state.currentRoom || 'dev',
        isError: isError,
        errorSummary: isError ? (typeof obj.content === 'string' ? obj.content.slice(0, 120) : '도구 실패') : null,
        resultSummary: typeof obj.content === 'string' ? obj.content.slice(0, 100) : '결과 수신'
      });
      return events;
    }

    return events;
  } catch (err) {
    return [];
  }
}

module.exports = {
  parseAntigravityLine
};
