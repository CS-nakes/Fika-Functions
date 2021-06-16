import { adminFirestore } from "./helpers/firebase";
import { firestore, logger } from "firebase-functions";
import _ from "lodash";

const TIMESLOTS = ["breakfast", "lunch", "tea"];
const userCollection = adminFirestore.collection("users");
const sessionCollection = adminFirestore.collection("sessions");

type TimeslotAndUser = {
  timeslotToUser: {
    [timeslot: string]: string[];
  };
  userToTimeslot: {
    [userId: string]: string[];
  };
};

export const createSessionOnCreateUser = firestore
  .document("users")
  .onCreate(async () => {
    try {
      const timeslotAndUser = await findAndGroupAvailableUsersPerTimeslot();
      return matchAvailableUsersPerTimeslot(timeslotAndUser);
    } catch (error) {
      logger.warn(error.message);
    }
  });

export const createSessionOnUpdateUserAvailability = firestore
  .document("users")
  .onUpdate(async (change) => {
    try {
      // Returns early if `isAvailable` is undefined OR false
      if (!change.after.data()?.isAvailable) {
        logger.log("Returns early!")
        return;
      }
      const timeslotAndUser = await findAndGroupAvailableUsersPerTimeslot();
      return matchAvailableUsersPerTimeslot(timeslotAndUser);
    } catch (error) {
      logger.warn(error.message);
    }
  });
  
const findAndGroupAvailableUsersPerTimeslot =
  async (): Promise<TimeslotAndUser> => {
    // Two maps for two-way location
    const timeslotToUser = {
      breakfast: [],
      lunch: [],
      tea: [],
    };
    const userToTimeslot = {};

    // Find available users
    const availableUsers = adminFirestore
      .collection("users")
      .where("isAvailable", "==", false);

    // Group available users based on their preferred timeslots
    // Note: users can be in grouped to multiple timeslots
    const promises = TIMESLOTS.map(async (timeslot) => {
      // Find ids of available users who prefer the timeslot
      const availUsersAtTimeslot = (
        await availableUsers
          .where("preferredTimeslots", "array-contains", timeslot)
          .get()
      ).docs.map((doc) => doc.id);

      // Update timeslot to user map
      timeslotToUser[timeslot] = availUsersAtTimeslot;

      // Update user to timeslot map
      availUsersAtTimeslot.forEach((userId) => {
        userToTimeslot[userId] = (userToTimeslot[userId] ?? []).concat(
          timeslot
        );
      });
    });

    await Promise.all(promises);

    return { timeslotToUser, userToTimeslot };
  };

// For each pair of users in the same timeslot, match them
// 1. [Firestore] Create an entry in `sessions`
// 2. [Firestore] Update both users' `isAvailable` status
// 3. [Local] Remove both users' from other timeslot groups
const matchAvailableUsersPerTimeslot = async ({
  timeslotToUser,
  userToTimeslot,
}: TimeslotAndUser) => {
  // Get pairs
  const pairs: string[][] = [];
  Object.keys(timeslotToUser).forEach((userIds) => {
    const timeslotPairs = _.chunk(userIds, 2).filter(
      (pair) => pair.length === 2
    );

    timeslotPairs.forEach((pair) => {
      // Add each pair to the `pairs`
      pairs.push(pair);
      // Remove both users from all of their timeslot groups
      pair.forEach((user) => {
        const timeslots = userToTimeslot[user];

        timeslots.forEach((timeslot) => {
          delete timeslotToUser[timeslot][user];
        });
      });
    });
  });

  const promises = pairs.map(async (pair) => {
    // 1. Create an entry in `sessions`
    sessionCollection.add({
      participants: pair,
      date: Date.now(),
    });
    // 2. Update both users' `isAvailable` status
    pair.forEach((userId) => {
      userCollection.doc(userId).update({
        isAvailable: true,
      });
    });
  });

  await Promise.all(promises);
};
