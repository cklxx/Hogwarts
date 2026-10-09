-------------------------- MODULE EmergentEcology --------------------------
(* Regional resources and house pressure. Hunts consume a bounded stock; quiet time restores it.
   Pressure creates control only with an absolute threshold and a lead, so ties never lock a zone. *)
EXTENDS Naturals

CONSTANTS Houses, MinResource, MaxResource, HuntCost, Recover, PressureGain, PressureDecay, ControlMin, ControlLead
VARIABLES resource, pressure
vars == <<resource, pressure>>

Init == resource \in MinResource..MaxResource /\ pressure = [h \in Houses |-> 0]

Hunt(h) ==
  /\ h \in Houses
  /\ resource' = IF resource > MinResource + HuntCost THEN resource - HuntCost ELSE MinResource
  /\ pressure' = [x \in Houses |-> IF x = h THEN IF pressure[x] + PressureGain > ControlMin + ControlLead THEN ControlMin + ControlLead ELSE pressure[x] + PressureGain ELSE pressure[x]]

Rest ==
  /\ resource' = IF resource + Recover > MaxResource THEN MaxResource ELSE resource + Recover
  /\ pressure' = [h \in Houses |-> IF pressure[h] > PressureDecay THEN pressure[h] - PressureDecay ELSE 0]

Next == Rest \/ \E h \in Houses : Hunt(h)

Leader(h) == pressure[h] >= ControlMin /\ \A q \in Houses \ {h} : pressure[h] >= pressure[q] + ControlLead
Controlled == {h \in Houses : Leader(h)}

ResourceBounded == resource \in MinResource..MaxResource
PressureNonNegative == \A h \in Houses : pressure[h] >= 0
AtMostOneController == \A a, b \in Controlled : a = b
=============================================================================
