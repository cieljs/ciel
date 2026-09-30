export interface RoomEvaluation {
  action: 'explore' | 'stay';
  confidence: number;
  score: number;
}

export type RoomSwitchDecision =
  | { shouldSwitch: false }
  | { shouldSwitch: true; reason: 'confirmed-explore' | 'sustained-low-score' };

export class RoomScorePolicy {
  private evaluations: RoomEvaluation[] = [];

  evaluate(evaluation: RoomEvaluation): RoomSwitchDecision {
    if (evaluation.score >= 60) {
      this.reset();

      return { shouldSwitch: false };
    }

    if (
      evaluation.action === 'explore' &&
      evaluation.confidence >= 0.85 &&
      evaluation.score <= 50
    ) {
      return this.switch('confirmed-explore');
    }

    this.evaluations.push(evaluation);
    this.evaluations = this.evaluations.slice(-3);

    const recentTwo = this.evaluations.slice(-2);

    if (recentTwo.length === 2 && recentTwo.every(item => item.score <= 20)) {
      return this.switch('sustained-low-score');
    }

    const confirmedExplore =
      recentTwo.length === 2 &&
      recentTwo.every(
        item => item.action === 'explore' && item.score <= 50 && item.confidence >= 0.7,
      );

    if (confirmedExplore) {
      return this.switch('confirmed-explore');
    }

    if (this.evaluations.length === 3) {
      const average = this.evaluations.reduce((sum, item) => sum + item.score, 0) / 3;
      const confidentCount = this.evaluations.filter(item => item.confidence >= 0.6).length;

      if (average <= 40 && confidentCount >= 2) {
        return this.switch('sustained-low-score');
      }
    }

    return { shouldSwitch: false };
  }

  reset(): void {
    this.evaluations = [];
  }

  private switch(reason: 'confirmed-explore' | 'sustained-low-score'): RoomSwitchDecision {
    this.reset();

    return { shouldSwitch: true, reason };
  }
}
