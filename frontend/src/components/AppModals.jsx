import { lazy, Suspense } from "react";
import FeedingForm from "./forms/FeedingForm";
import SleepForm from "./forms/SleepForm";
import DiaperForm from "./forms/DiaperForm";
import TemperatureForm from "./forms/TemperatureForm";
import TummyTimeForm from "./forms/TummyTimeForm";
import NoteForm from "./forms/NoteForm";
import WeightForm from "./forms/WeightForm";
import HeightForm from "./forms/HeightForm";
import HeadCircumferenceForm from "./forms/HeadCircumferenceForm";
import MedicationForm from "./forms/MedicationForm";
import MilestoneForm from "./forms/MilestoneForm";
import PumpingForm from "./forms/PumpingForm";
import MilkWasteForm from "./forms/MilkWasteForm";
import BMIForm from "./forms/BMIForm";
import ChildForm from "./forms/ChildForm";
import EditChildForm from "./forms/EditChildForm";
import { useSession } from "../core/session";
import { usePreferences } from "../utils/preferences";
const SettingsModal = lazy(() => import("./SettingsModal"));

// useAppModal holds which dialog is open: an entry form (new, edit, or saving
// a stopped timer), a child form, or Settings. `modal` is null or
// { type, entry?, timerId?, child? }.
export function useAppModal() {
  const { data, timer, modal, setModal } = useSession();

  const closeModal = () => {
    // Cancelling a timer-backed entry form leaves the timer running on the
    // server — bring its bar back right away instead of on the next poll.
    if (modal?.timerId) timer.resumeTimer(modal.timerId);
    setModal(null);
  };
  const handleFormDone = () => {
    // Deliberately not closeModal(): saving deletes the server timer, so the
    // suppressed bar must stay hidden (the next refetch cleans it up).
    setModal(null);
    data.refetch();
  };

  return { modal, setModal, closeModal, handleFormDone };
}

// AppModals renders the dialog `modal` asks for. Any UI can reuse the full
// entry forms this way, including one that has simpler forms of its own for
// the common cases.
export default function AppModals({ modal, setModal, closeModal, handleFormDone }) {
  const { data, isAdmin, demoMode, applianceMode, onLogout, deleteEntry: handleDeleteEntry, userUi, setUserUi } = useSession();
  const { getFormDefault } = usePreferences();

  return (
    <>
      {modal?.type === "feeding" && (
        <FeedingForm
          childId={data.child?.id}
          timerId={modal.timerId}
          entry={modal.entry}
          defaultType={getFormDefault("feeding", "type")}
          defaultMethod={getFormDefault("feeding", "method")}
          onDone={handleFormDone}
          onClose={closeModal}
          onDelete={modal.entry ? () => { handleDeleteEntry("feeding", modal.entry.id); closeModal(); } : undefined}
        />
      )}
      {modal?.type === "sleep" && (
        <SleepForm
          childId={data.child?.id}
          timerId={modal.timerId}
          entry={modal.entry}
          onDone={handleFormDone}
          onClose={closeModal}
          onDelete={modal.entry ? () => { handleDeleteEntry("sleep", modal.entry.id); closeModal(); } : undefined}
        />
      )}
      {modal?.type === "diaper" && (
        <DiaperForm
          childId={data.child?.id}
          entry={modal.entry}
          onDone={handleFormDone}
          onClose={closeModal}
          onDelete={modal.entry ? () => { handleDeleteEntry("diaper", modal.entry.id); closeModal(); } : undefined}
        />
      )}
      {modal?.type === "temp" && (
        <TemperatureForm
          childId={data.child?.id}
          entry={modal.entry}
          onDone={handleFormDone}
          onClose={closeModal}
          onDelete={modal.entry ? () => { handleDeleteEntry("temp", modal.entry.id); closeModal(); } : undefined}
        />
      )}
      {modal?.type === "tummy" && (
        <TummyTimeForm
          childId={data.child?.id}
          timerId={modal.timerId}
          entry={modal.entry}
          onDone={handleFormDone}
          onClose={closeModal}
          onDelete={modal.entry ? () => { handleDeleteEntry("tummy", modal.entry.id); closeModal(); } : undefined}
        />
      )}
      {modal?.type === "weight" && (
        <WeightForm
          childId={data.child?.id}
          entry={modal.entry}
          onDone={handleFormDone}
          onClose={closeModal}
          onDelete={modal.entry ? () => { handleDeleteEntry("weight", modal.entry.id); closeModal(); } : undefined}
        />
      )}
      {modal?.type === "height" && (
        <HeightForm
          childId={data.child?.id}
          entry={modal.entry}
          onDone={handleFormDone}
          onClose={closeModal}
          onDelete={modal.entry ? () => { handleDeleteEntry("height", modal.entry.id); closeModal(); } : undefined}
        />
      )}
      {modal?.type === "note" && (
        <NoteForm
          childId={data.child?.id}
          entry={modal.entry}
          onDone={handleFormDone}
          onClose={closeModal}
          onDelete={modal.entry ? () => { handleDeleteEntry("note", modal.entry.id); closeModal(); } : undefined}
        />
      )}
      {modal?.type === "headcirc" && (
        <HeadCircumferenceForm
          childId={data.child?.id}
          entry={modal.entry}
          onDone={handleFormDone}
          onClose={closeModal}
          onDelete={modal.entry ? () => { handleDeleteEntry("headcirc", modal.entry.id); closeModal(); } : undefined}
        />
      )}
      {modal?.type === "medication" && (
        <MedicationForm
          childId={data.child?.id}
          entry={modal.entry}
          defaultDosageUnit={getFormDefault("medication", "dosage_unit")}
          onDone={handleFormDone}
          onClose={closeModal}
          onDelete={modal.entry ? () => { handleDeleteEntry("medication", modal.entry.id); closeModal(); } : undefined}
        />
      )}
      {modal?.type === "bmi" && (
        <BMIForm
          childId={data.child?.id}
          entry={modal.entry}
          onDone={handleFormDone}
          onClose={closeModal}
          onDelete={modal.entry ? () => { handleDeleteEntry("bmi", modal.entry.id); closeModal(); } : undefined}
        />
      )}
      {modal?.type === "pumping" && (
        <PumpingForm
          childId={data.child?.id}
          entry={modal.entry}
          onDone={handleFormDone}
          onClose={closeModal}
          onDelete={modal.entry ? () => { handleDeleteEntry("pumping", modal.entry.id); closeModal(); } : undefined}
        />
      )}
      {modal?.type === "milkWaste" && (
        <MilkWasteForm
          childId={data.child?.id}
          entry={modal.entry}
          onDone={handleFormDone}
          onClose={closeModal}
          onDelete={modal.entry ? () => { handleDeleteEntry("milkWaste", modal.entry.id); closeModal(); } : undefined}
        />
      )}
      {modal?.type === "milestone" && (
        <MilestoneForm
          childId={data.child?.id}
          entry={modal.entry}
          onDone={handleFormDone}
          onClose={closeModal}
          onDelete={modal.entry ? () => { handleDeleteEntry("milestone", modal.entry.id); closeModal(); } : undefined}
        />
      )}
      {modal?.type === "addChild" && (
        <ChildForm
          onDone={handleFormDone}
          onClose={closeModal}
        />
      )}
      {modal?.type === "editChild" && modal.child && (
        <EditChildForm
          child={modal.child}
          onDone={handleFormDone}
          onClose={closeModal}
          onDelete={isAdmin ? () => { handleDeleteEntry("child", modal.child.id); closeModal(); } : undefined}
          onAddBaby={isAdmin ? () => setModal({ type: "addChild" }) : undefined}
        />
      )}
      {modal?.type === "settings" && (
        <Suspense fallback={null}>
        <SettingsModal
          childId={data.child?.id}
          unitSystem={data.unitSystem}
          onUnitSystemChange={data.setUnitSystem}
          children={data.children}
          isAdmin={isAdmin}
          applianceMode={applianceMode}
          onClose={closeModal}
          onLogout={demoMode ? undefined : onLogout}
          onRefetch={data.refetch}
          userUi={userUi}
          onUserUiChange={demoMode ? undefined : setUserUi}
        />
        </Suspense>
      )}
    </>
  );
}
