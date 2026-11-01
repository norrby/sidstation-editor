// liveparam.js – does automation play one of this device's parameters right now? (Live's API; bundled into the scripts whose rules
// write a parameter: sid.osc.js, sid.map.js.)
// A rule (choosing Off turns Active off, osc 3's Off takes it off the filter …) writes a Live parameter, and Live takes that as a change
// by hand: automation on that parameter stops until Re-Enable Automation, and the rule wins over what the clip says. So a rule leaves
// both parameters alone while automation plays the one that triggered it or the one it would write (automation_state 1; 2 = already
// overridden by hand, 0 = none). Parameters are found by their short name, the only name the API sees (build/station/names.js).
//   sidAutomated(shortName)    true while automation plays it; false outside Live, for an unknown name, or on any error
let sidParamIds = null;
function sidAutomated(shortName) {
  if (typeof LiveAPI === "undefined") return false;
  try {
    if (!sidParamIds) {
      sidParamIds = {};
      const ids = new LiveAPI("this_device").get("parameters");          // ["id", 12, "id", 13, …]
      for (let i = 1; i < ids.length; i += 2) sidParamIds[String(new LiveAPI("id " + ids[i]).get("name"))] = ids[i];
    }
    const id = sidParamIds[shortName];
    return id !== undefined && Number(new LiveAPI("id " + id).get("automation_state")) === 1;
  } catch (e) { return false; }
}

if (typeof module !== "undefined" && module.exports) module.exports = { sidAutomated };
