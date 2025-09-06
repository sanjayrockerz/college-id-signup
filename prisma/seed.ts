import { PrismaClient } from '../src/infra/prisma/mock-prisma-client';

// Node.js global types for development
declare const process: {
  exit: (code?: number) => never;
};

const prisma = new PrismaClient();

async function main() {
  console.log('Starting database seed...');

  // Create sample users
  const user1 = await prisma.user.create({
    data: {
      email: 'john.doe@university.edu',
      username: 'johndoe',
      firstName: 'John',
      lastName: 'Doe',
      bio: 'Computer Science student at State University',
      isVerified: true,
      verifiedCollegeId: 'state-university',
      collegeName: 'State University',
      studentIdNumber: 'SU123456',
      graduationYear: 2025,
      profileVisibility: 'PUBLIC',
    },
  });

  const user2 = await prisma.user.create({
    data: {
      email: 'jane.smith@university.edu',
      username: 'janesmith',
      firstName: 'Jane',
      lastName: 'Smith',
      bio: 'Business major, love networking!',
      isVerified: true,
      verifiedCollegeId: 'state-university',
      collegeName: 'State University',
      studentIdNumber: 'SU789012',
      graduationYear: 2024,
      profileVisibility: 'PUBLIC',
    },
  });

  const user3 = await prisma.user.create({
    data: {
      email: 'mike.johnson@college.edu',
      username: 'mikej',
      firstName: 'Mike',
      lastName: 'Johnson',
      bio: 'Engineering student, always building something new',
      isVerified: true,
      verifiedCollegeId: 'tech-college',
      collegeName: 'Tech College',
      studentIdNumber: 'TC345678',
      graduationYear: 2026,
      profileVisibility: 'CONNECTIONS_ONLY',
    },
  });

  console.log('Created users:', { user1: user1.id, user2: user2.id, user3: user3.id });

  // Create connections
  const connection1 = await prisma.connection.create({
    data: {
      requesterId: user1.id,
      receiverId: user2.id,
      status: 'ACCEPTED',
      isCloseFriend: true,
    },
  });

  const connection2 = await prisma.connection.create({
    data: {
      requesterId: user2.id,
      receiverId: user3.id,
      status: 'ACCEPTED',
      isCloseFriend: false,
    },
  });

  const connection3 = await prisma.connection.create({
    data: {
      requesterId: user1.id,
      receiverId: user3.id,
      status: 'PENDING',
      isCloseFriend: false,
    },
  });

  console.log('Created connections:', { 
    connection1: connection1.id, 
    connection2: connection2.id, 
    connection3: connection3.id 
  });

  // Create sample posts
  const post1 = await prisma.post.create({
    data: {
      content: 'Just finished my first semester project! So excited to share what I\'ve learned.',
      authorId: user1.id,
      visibility: 'PUBLIC',
      allowComments: true,
      allowSharing: true,
      viewCount: 25,
    },
  });

  const post2 = await prisma.post.create({
    data: {
      content: 'Looking for study partners for the upcoming finals. DM me if interested!',
      authorId: user2.id,
      visibility: 'CONNECTIONS_ONLY',
      allowComments: true,
      allowSharing: false,
      viewCount: 12,
    },
  });

  const post3 = await prisma.post.create({
    data: {
      content: 'Anonymous confession: I still don\'t know what I want to do after graduation 😅',
      authorId: user1.id,
      isAnonymous: true,
      visibility: 'PUBLIC',
      allowComments: true,
      allowSharing: true,
      viewCount: 89,
    },
  });

  const post4 = await prisma.post.create({
    data: {
      content: 'Building a new app for our capstone project. Anyone have experience with React Native?',
      authorId: user3.id,
      visibility: 'CLOSE_FRIENDS_ONLY',
      allowComments: true,
      allowSharing: true,
      viewCount: 5,
    },
  });

  const post5 = await prisma.post.create({
    data: {
      content: 'The campus coffee shop has the best latte art! ☕️ #CampusLife',
      authorId: user2.id,
      visibility: 'PUBLIC',
      allowComments: true,
      allowSharing: true,
      viewCount: 34,
    },
  });

  console.log('Created posts:', { 
    post1: post1.id, 
    post2: post2.id, 
    post3: post3.id, 
    post4: post4.id, 
    post5: post5.id 
  });

  // Create interactions
  await prisma.interaction.create({
    data: {
      type: 'LIKE',
      userId: user2.id,
      postId: post1.id,
    },
  });

  await prisma.interaction.create({
    data: {
      type: 'LIKE',
      userId: user3.id,
      postId: post1.id,
    },
  });

  await prisma.interaction.create({
    data: {
      type: 'LIKE',
      userId: user1.id,
      postId: post2.id,
    },
  });

  await prisma.interaction.create({
    data: {
      type: 'LIKE',
      userId: user1.id,
      postId: post5.id,
    },
  });

  await prisma.interaction.create({
    data: {
      type: 'SHARE',
      userId: user2.id,
      postId: post3.id,
    },
  });

  console.log('Created interactions');

  // Create coolness ratings
  await prisma.coolnessRating.create({
    data: {
      rating: 4,
      userId: user2.id,
      postId: post1.id,
    },
  });

  await prisma.coolnessRating.create({
    data: {
      rating: 5,
      userId: user3.id,
      postId: post1.id,
    },
  });

  await prisma.coolnessRating.create({
    data: {
      rating: 3,
      userId: user1.id,
      postId: post2.id,
    },
  });

  await prisma.coolnessRating.create({
    data: {
      rating: 5,
      userId: user1.id,
      postId: post5.id,
    },
  });

  console.log('Created coolness ratings');

  // Create post views
  await prisma.postView.create({
    data: {
      userId: user2.id,
      postId: post1.id,
    },
  });

  await prisma.postView.create({
    data: {
      userId: user3.id,
      postId: post1.id,
    },
  });

  await prisma.postView.create({
    data: {
      userId: user1.id,
      postId: post2.id,
    },
  });

  console.log('Created post views');

  console.log('Database seed completed successfully!');
}

main()
  .catch((e) => {
    console.error('Error during seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
