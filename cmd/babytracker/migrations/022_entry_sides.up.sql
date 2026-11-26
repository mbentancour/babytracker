-- The two sides of one entry. A pumping session can say how much each breast
-- gave; `amount` stays the session's total, the figure every chart and the
-- milk stock read. A feed on both breasts can say how long each side took.
-- All four are optional: an entry without them reads as it did before.

ALTER TABLE pumping ADD COLUMN amount_left DOUBLE PRECISION CHECK (amount_left >= 0);
ALTER TABLE pumping ADD COLUMN amount_right DOUBLE PRECISION CHECK (amount_right >= 0);

ALTER TABLE feedings ADD COLUMN left_seconds INTEGER CHECK (left_seconds >= 0);
ALTER TABLE feedings ADD COLUMN right_seconds INTEGER CHECK (right_seconds >= 0);
