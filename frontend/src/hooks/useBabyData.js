import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "../api";
import { getMockData } from "../utils/mockData";

function toLocalISODate(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function fixChildPicture(c) {
  if (c?.picture) {
    // If it's already a relative API path, leave as-is
    if (c.picture.startsWith("./api/") || c.picture.startsWith("/api/")) {
      return c;
    }
    // Cache-bust with updated_at or current time
    const cb = c.updated_at ? new Date(c.updated_at).getTime() : Date.now();
    try {
      // Handle absolute URLs (legacy Baby Buddy format)
      const url = new URL(c.picture);
      c.picture = `./api/media${url.pathname}?v=${cb}`;
    } catch {
      // Assume it's a filename, build the API path
      if (c.picture && !c.picture.startsWith("http")) {
        c.picture = `./api/media/photos/${c.picture}?size=thumb&v=${cb}`;
      }
    }
  }
  return c;
}

const emptyPage = { results: [], count: 0 };

export function useBabyData(canReadFn) {
  const canReadRef = useRef(canReadFn || (() => true));
  canReadRef.current = canReadFn || (() => true);
  const [children, setChildren] = useState([]);
  const [child, setChild] = useState(null);
  const [feedings, setFeedings] = useState([]);
  const [weeklyFeedings, setWeeklyFeedings] = useState([]);
  const [sleepEntries, setSleepEntries] = useState([]);
  const [weeklySleep, setWeeklySleep] = useState([]);
  const [changes, setChanges] = useState([]);
  const [tummyTimes, setTummyTimes] = useState([]);
  const [weeklyTummyTimes, setWeeklyTummyTimes] = useState([]);
  const [temperatures, setTemperatures] = useState([]);
  const [weights, setWeights] = useState([]);
  const [heights, setHeights] = useState([]);
  const [monthlyFeedings, setMonthlyFeedings] = useState([]);
  const [monthlySleep, setMonthlySleep] = useState([]);
  const [notes, setNotes] = useState([]);
  const [timers, setTimers] = useState([]);
  const [headCircumferences, setHeadCircumferences] = useState([]);
  const [medications, setMedications] = useState([]);
  const [milestones, setMilestones] = useState([]);
  const [bmiEntries, setBmiEntries] = useState([]);
  // Per-entity-type tag maps: `tagMaps[entityType][entity_id] = [tag...]`.
  // Populated from the /api/tags/bulk endpoint on every refresh so list
  // views can render tag chips without N+1 fetches.
  const [tagMaps, setTagMaps] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastSync, setLastSync] = useState(null);
  const [unitSystem, setUnitSystem] = useState(
    () => localStorage.getItem("babytracker_units") || "metric"
  );
  const intervalRef = useRef(null);
  const childIdRef = useRef(null);

  const fetchData = useCallback(async (childId) => {
    try {
      const now = new Date();

      const todayStr = toLocalISODate(now);
      const todayMin = `${todayStr}T00:00:00`;
      const todayMax = `${todayStr}T23:59:59`;

      const twentyFourAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const sleepMin = `${toLocalISODate(twentyFourAgo)}T${String(twentyFourAgo.getHours()).padStart(2, "0")}:${String(twentyFourAgo.getMinutes()).padStart(2, "0")}:00`;

      const weekAgo = new Date(now);
      weekAgo.setDate(weekAgo.getDate() - 6);
      const weekMin = `${toLocalISODate(weekAgo)}T00:00:00`;

      const monthAgo = new Date(now);
      monthAgo.setDate(monthAgo.getDate() - 29);
      const monthMin = `${toLocalISODate(monthAgo)}T00:00:00`;

      const c = childId || undefined;

      const [
        feedingsRes,
        weeklyFeedingsRes,
        sleepRes,
        weeklySleepRes,
        changesRes,
        tummyRes,
        weeklyTummyRes,
        tempRes,
        weightRes,
        heightRes,
        timersRes,
        notesRes,
        monthlyFeedingsRes,
        monthlySleepRes,
        headCircRes,
        medicationsRes,
        milestonesRes,
        bmiRes,
      ] = await Promise.all((() => {
        // Only fetch data for features the user can read
        const ep = emptyPage;
        const q = (feature, call) => canReadRef.current(feature) ? call : Promise.resolve(ep);
        return [
        q("feeding", api.getFeedings({ child: c, start_min: todayMin, start_max: todayMax, limit: 100, ordering: "-start" })),
        q("feeding", api.getFeedings({ child: c, start_min: weekMin, limit: 200, ordering: "-start" })),
        q("sleep", api.getSleep({ child: c, start_min: sleepMin, limit: 100, ordering: "-start" })),
        q("sleep", api.getSleep({ child: c, start_min: weekMin, limit: 200, ordering: "-start" })),
        q("diaper", api.getChanges({ child: c, date_min: todayMin, date_max: todayMax, limit: 100, ordering: "-time" })),
        q("tummy", api.getTummyTimes({ child: c, start_min: todayMin, start_max: todayMax, limit: 100, ordering: "-start" })),
        q("tummy", api.getTummyTimes({ child: c, start_min: weekMin, limit: 200, ordering: "-start" })),
        q("temp", api.getTemperature({ child: c, limit: 10, ordering: "-time" })),
        q("weight", api.getWeight({ child: c, limit: 20, ordering: "-date" })),
        q("height", api.getHeight({ child: c, limit: 20, ordering: "-date" })),
        q("feeding", api.getTimers()),
        q("note", api.getNotes({ child: c, limit: 20, ordering: "-time" })),
        q("feeding", api.getFeedings({ child: c, start_min: monthMin, limit: 500, ordering: "-start" })),
        q("sleep", api.getSleep({ child: c, start_min: monthMin, limit: 500, ordering: "-start" })),
        q("headcirc", api.getHeadCircumference({ child: c, limit: 20, ordering: "-date" })),
        q("medication", api.getMedications({ child: c, limit: 20, ordering: "-time" })),
        q("milestone", api.getMilestones({ child: c, limit: 50, ordering: "-date" })),
        q("bmi", api.getBMI({ child: c, limit: 20, ordering: "-date" })),
        ];
      })());

      setFeedings(feedingsRes.results || []);
      setWeeklyFeedings(weeklyFeedingsRes.results || []);
      setSleepEntries(sleepRes.results || []);
      setWeeklySleep(weeklySleepRes.results || []);
      setChanges(changesRes.results || []);
      setTummyTimes(tummyRes.results || []);
      setWeeklyTummyTimes(weeklyTummyRes.results || []);
      setTemperatures(tempRes.results || []);
      setWeights(weightRes.results || []);
      setHeights(heightRes.results || []);
      setTimers(timersRes.results || []);
      setNotes(notesRes.results || []);
      setMonthlyFeedings(monthlyFeedingsRes.results || []);
      setMonthlySleep(monthlySleepRes.results || []);
      setHeadCircumferences(headCircRes.results || []);
      setMedications(medicationsRes.results || []);
      setMilestones(milestonesRes.results || []);
      setBmiEntries(bmiRes.results || []);

      // Fetch tag maps for every taggable entity type in parallel. Each
      // returns `{ "<entity_id>": [tag, tag, ...] }`; we only populate
      // entries that actually have tags (untagged entities are absent).
      // A failure here shouldn't break the dashboard — fall back to empty.
      const tagTypes = [
        "feeding", "sleep", "diaper", "tummy_time", "pumping",
        "temperature", "medication", "note", "milestone",
        "weight", "height", "head_circumference", "bmi",
      ];
      try {
        const results = await Promise.all(
          tagTypes.map((t) => api.getEntityTagsBulk(t).catch(() => ({}))),
        );
        const nextMaps = {};
        tagTypes.forEach((t, i) => { nextMaps[t] = results[i] || {}; });
        setTagMaps(nextMaps);
      } catch {
        setTagMaps({});
      }

      setLastSync(new Date());
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchAll = useCallback(async () => {
    try {
      const childrenRes = await api.getChildren();
      const allChildren = (childrenRes.results || []).map(fixChildPicture);
      setChildren(allChildren);

      const active = allChildren.find((c) => c.id === childIdRef.current) || allChildren[0] || null;
      if (active) {
        childIdRef.current = active.id;
        setChild(active);
      }

      await fetchData(active?.id);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }, [fetchData]);

  const selectChild = useCallback(
    (id) => {
      const selected = children.find((c) => c.id === id);
      if (!selected || selected.id === child?.id) return;
      childIdRef.current = id;
      setChild(selected);
      setLoading(true);
      fetchData(id);
    },
    [children, child, fetchData]
  );

  const loadMock = useCallback(() => {
    const mock = getMockData();
    setChildren(mock.children);
    setChild(mock.children[0]);
    childIdRef.current = mock.children[0].id;
    setFeedings(mock.feedings);
    setWeeklyFeedings(mock.weeklyFeedings);
    setSleepEntries(mock.sleepEntries);
    setWeeklySleep(mock.weeklySleep);
    setChanges(mock.changes);
    setTummyTimes(mock.tummyTimes);
    setWeeklyTummyTimes(mock.weeklyTummyTimes);
    setTemperatures(mock.temperatures);
    setWeights(mock.weights);
    setHeights(mock.heights);
    setTimers(mock.timers);
    setNotes(mock.notes);
    setMonthlyFeedings(mock.monthlyFeedings);
    setMonthlySleep(mock.monthlySleep);
    setLastSync(new Date());
    setLoading(false);
  }, []);

  const selectMockChild = useCallback(
    (id) => {
      const selected = children.find((c) => c.id === id);
      if (!selected || selected.id === child?.id) return;
      childIdRef.current = id;
      setChild(selected);
      const mock = getMockData(id);
      setFeedings(mock.feedings);
      setWeeklyFeedings(mock.weeklyFeedings);
      setSleepEntries(mock.sleepEntries);
      setWeeklySleep(mock.weeklySleep);
      setChanges(mock.changes);
      setTummyTimes(mock.tummyTimes);
      setWeeklyTummyTimes(mock.weeklyTummyTimes);
      setTemperatures(mock.temperatures);
      setWeights(mock.weights);
      setHeights(mock.heights);
      setTimers(mock.timers);
      setNotes(mock.notes);
      setMonthlyFeedings(mock.monthlyFeedings);
      setMonthlySleep(mock.monthlySleep);
    },
    [children, child]
  );

  const demoRef = useRef(false);

  useEffect(() => {
    api
      .getConfig()
      .then((cfg) => {
        const savedUnits = localStorage.getItem("babytracker_units");
        if (savedUnits) {
          setUnitSystem(savedUnits);
        } else if (cfg.unit_system) {
          setUnitSystem(cfg.unit_system);
        }
        if (cfg.demo_mode) {
          demoRef.current = true;
          loadMock();
        } else {
          fetchAll();
          const ms = (cfg.refresh_interval || 30) * 1000;
          intervalRef.current = setInterval(fetchAll, ms);
        }
      })
      .catch(() => {
        fetchAll();
        intervalRef.current = setInterval(fetchAll, 30000);
      });

    return () => clearInterval(intervalRef.current);
  }, [fetchAll, loadMock]);

  return {
    children,
    child,
    selectChild: demoRef.current ? selectMockChild : selectChild,
    feedings,
    weeklyFeedings,
    sleepEntries,
    weeklySleep,
    changes,
    tummyTimes,
    weeklyTummyTimes,
    temperatures,
    weights,
    heights,
    monthlyFeedings,
    monthlySleep,
    notes,
    timers,
    headCircumferences,
    medications,
    milestones,
    bmiEntries,
    tagMaps,
    loading,
    error,
    lastSync,
    unitSystem,
    refetch: fetchAll,
  };
}
