import Link from '@docusaurus/Link';
import clsx from 'clsx';
import React from 'react';

import { Sponsors } from './Sponsors';
import styles from './styles.module.css';

export function FinancialContributors(): JSX.Element {
  return (
    <>
      <p>
        The TypeScript ESLint project would not be possible without the generous
        support of our financial contributors.
      </p>
      <div className={styles.sponsorsContainer}>
        <Sponsors
          className={styles.tierSponsorArea}
          include={{ link: true, name: true }}
          tier="sponsor"
          title="Platinum Sponsors"
        />
        <Sponsors
          className={styles.tierSupporterArea}
          include={{ link: true }}
          tier="supporter"
          title="Gold Supporters"
        />
        <Sponsors
          className={styles.tierOtherArea}
          tier="contributor"
          title="Silver Supporters"
        />
      </div>
      <div className={styles.linksArea}>
        <Link
          className={clsx('button button--primary', styles.become)}
          to="https://opencollective.com/typescript-eslint/contribute"
          target="_blank"
        >
          Become a financial contributor
        </Link>
        <div className={styles.linksSmaller}>
          <Link
            className="button button--info button--outline"
            to="https://opencollective.com/typescript-eslint"
            target="_blank"
          >
            See all financial contributors
          </Link>
          <Link
            className="button button--info button--outline"
            to="https://github.com/typescript-eslint/typescript-eslint/blob/main/SPONSORSHIP.md"
            target="_blank"
          >
            Learn more
          </Link>
        </div>
      </div>
    </>
  );
}
