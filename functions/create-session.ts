import { adminFirestore } from "./helpers/firebase";
import { firestore, logger } from "firebase-functions";
import _ from "lodash";
import * as admin from "firebase-admin"; 

const TIMESLOTS = ["breakfast", "lunch", "tea"];
const userCollection = adminFirestore.collection("users");
const sessionCollection = adminFirestore.collection("sessions");

type TimeslotToUser = {
  [timeslot: string]: string[];
};

export const createSessionOnCreateUser = firestore
  .document("users/{userId}")
  .onCreate(async () => {
    try {
      const timeslotAndUser = await findAndGroupAvailableUsersPerTimeslot();
      return matchAvailableUsersPerTimeslot(timeslotAndUser);
    } catch (error) {
      logger.warn(error.message);
    }
  });

export const createSessionOnUpdateUserAvailability = firestore
  .document("users/{userId}")
  .onUpdate(async () => {
    try {
      const timeslotAndUser = await findAndGroupAvailableUsersPerTimeslot();
      return matchAvailableUsersPerTimeslot(timeslotAndUser);
    } catch (error) {
      logger.warn(error.message);
    }
  });

const findAndGroupAvailableUsersPerTimeslot =
  async (): Promise<TimeslotToUser> => {
    const timeslotToUser = {
      breakfast: [],
      lunch: [],
      tea: [],
    };

    // Group available users based on their preferred timeslots
    // Note: users can be in grouped to multiple timeslots
    const promises = TIMESLOTS.map(async (timeslot) => {
      // Find ids of available users who prefer the timeslot
      const availUsersAtTimeslot = (
        await adminFirestore
          .collection("users")
          .where("isAvailable", "==", true)
          .where("preferredTimeslots", "array-contains", timeslot)
          .get()
      ).docs.map((doc) => doc.id);
      // Update timeslot to user map
      timeslotToUser[timeslot] = availUsersAtTimeslot;
    });

    await Promise.all(promises);

    return timeslotToUser;
  };

// For each pair of users in the same timeslot, match them
// 1. [Firestore] Create an entry in `sessions`
// 2. [Firestore] Update both users' `isAvailable` status
// 3. [Local] Remove both users' from other timeslot groups
type PairTimeslot = {
  pair: string[];
  timeslot: string;
};

const matchAvailableUsersPerTimeslot = async (
  timeslotToUser: TimeslotToUser
) => {
  // Get pairs
  const pairTimeslotArr: PairTimeslot[] = [];
  const pairedUsers: string[] = [];

  Object.entries(timeslotToUser).forEach(([timeslot, userIds]) => {
    const unpairedUserIds = userIds.filter(
      (userId) => !pairedUsers.includes(userId)
    );
    const timeslotPairs = _.chunk(unpairedUserIds, 2).filter(
      (pair) => pair.length === 2
    );

    timeslotPairs.forEach((pair) => {
      // Add each pair to the `pairs`
      pairTimeslotArr.push({ pair, timeslot });
      // Prevent paired users from participating in the next matching stages
      pairedUsers.push(pair[0]);
      pairedUsers.push(pair[1]);
    });
  });

  const promises = pairTimeslotArr.map(async ({ pair, timeslot }) => {
    // 1. Create an entry in `sessions`
    const date = new Date();
    date.setDate(date.getDate() + 7); 

    sessionCollection.add({
      participants: pair,
      date: admin.firestore.Timestamp.fromDate(date),
      timeslot,
    });
    // 2. Update both users' `isAvailable` status
    pair.forEach((userId) => {
      userCollection.doc(userId).update({
        isAvailable: false,
      });
    });
  });

  await Promise.all(promises);
};
